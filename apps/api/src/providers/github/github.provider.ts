import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';

import {
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../provider.errors';
import { GitHubAppAuth } from './github-app-auth';
import {
  type GqlCommit,
  type GqlPullRequest,
  type GqlRepository,
  mapAuthoredPullRequest,
  mapCommit,
  mapRepository,
  mapReviewedPullRequest,
  searchRange,
  splitWindow,
} from './mappers';
import {
  AUTHORED_SEARCH,
  COMMIT_REPOSITORIES,
  REVIEWED_SEARCH,
  SINGLE_PR,
  commitHistoryQuery,
} from './queries';
import { parseGitHubWebhook, verifyGitHubSignature } from './webhook';

import type { Env } from '../../config/env';
import type {
  ActivityProvider,
  CommitPage,
  CommitRepositoryActivity,
  CommitRequest,
  NormalizedInstallation,
  NormalizedPullRequest,
  NormalizedRepository,
  NormalizedReviewedPullRequest,
  ProviderAccount,
  ProviderSession,
  ProviderSessionOptions,
  ProviderStats,
  ProviderTokenSet,
  ProviderWebhookEvent,
  SearchPage,
  TimeWindow,
} from '@devimpact/shared';

const GitHubOctokit = Octokit.plugin(retry, throttling);
type GitHubOctokitInstance = InstanceType<typeof GitHubOctokit>;

/** GitHub's search API returns at most 1,000 results per query (ADR-0007). */
export const SEARCH_RESULT_CAP = 1000;
export const SEARCH_PAGE_SIZE = 50;
/** Repositories per batched history request. */
export const COMMIT_BATCH_SIZE = 10;
const MIN_SPLIT_MS = 60_000;
const YEAR_MS = 365 * 86_400_000;
const DEFAULT_MIN_REMAINING = 200;

interface GraphQLResponse<T> {
  data?: T;
  errors?: { type?: string; message: string; path?: (string | number)[] }[];
}

interface RateLimitInfo {
  rateLimit?: { cost: number; remaining: number; resetAt: string } | null;
}

interface SearchResult<N extends object> extends RateLimitInfo {
  search: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: (N | Record<string, never> | null)[];
  };
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
}

/**
 * One authenticated conversation with GitHub (one Octokit per job, ADR-0007): throttling + retry
 * plugins, token injection at call time, central rate-limit accounting and pause-before-exhaustion.
 */
export class GitHubSession implements ProviderSession {
  readonly stats: ProviderStats = {
    requests: 0,
    graphqlPoints: 0,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
  };
  private readonly octokit: GitHubOctokitInstance;
  private readonly minRemaining: number;

  constructor(
    baseUrl: string,
    private readonly options: ProviderSessionOptions,
    retries: number,
    throttlingEnabled = true,
  ) {
    this.minRemaining = options.minRemaining ?? DEFAULT_MIN_REMAINING;
    this.octokit = new GitHubOctokit({
      baseUrl,
      userAgent: 'DevImpact-AI-sync',
      request: {
        fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => globalThis.fetch(input, init),
      },
      retry: { retries, doNotRetry: [400, 401, 403, 404, 422, 429, 451] },
      throttle: {
        enabled: throttlingEnabled,
        // GitHub asks for serial, paced POSTs (GraphQL included); pace per token, not globally.
        id: options.key ?? 'devimpact',
        // Primary limit: never sleep inside the job — we persist cursors and reschedule instead.
        onRateLimit: () => false,
        // Secondary (abuse) limit: one polite retry, then surface as a rate-limit pause.
        onSecondaryRateLimit: (_after: number, _opts: unknown, _o: unknown, retryCount: number) =>
          retryCount < 1,
      },
    });
    this.octokit.hook.wrap('request', async (request, requestOptions) => {
      this.assertBudget();
      let token = await this.options.getAccessToken();
      for (let attempt = 0; ; attempt++) {
        requestOptions.headers.authorization = `bearer ${token}`;
        this.stats.requests++;
        try {
          const response = await request(requestOptions);
          this.recordHeaders(response.headers);
          return response;
        } catch (error) {
          const err = error as {
            status?: number;
            response?: { headers?: Record<string, unknown> };
          };
          this.recordHeaders(err.response?.headers);
          if (err.status === 401 && attempt === 0) {
            const refreshed = await this.options.onUnauthorized();
            if (!refreshed) throw new ProviderAuthError('TOKEN_REVOKED');
            token = refreshed;
            continue;
          }
          throw this.mapError(err);
        }
      }
    });
  }

  private assertBudget(): void {
    const { rateLimitRemaining, rateLimitResetAt } = this.stats;
    if (rateLimitRemaining !== null && rateLimitRemaining < this.minRemaining) {
      throw new ProviderRateLimitError(
        rateLimitResetAt ?? new Date(Date.now() + 60 * 60_000),
        rateLimitRemaining,
      );
    }
  }

  private recordHeaders(headers: Record<string, unknown> | undefined): void {
    const remaining = headerValue(headers, 'x-ratelimit-remaining');
    const reset = headerValue(headers, 'x-ratelimit-reset');
    if (remaining !== undefined) this.stats.rateLimitRemaining = Number(remaining);
    if (reset !== undefined) this.stats.rateLimitResetAt = new Date(Number(reset) * 1000);
  }

  private mapError(err: {
    status?: number;
    message?: string;
    response?: { headers?: Record<string, unknown> };
  }): Error {
    if (err instanceof ProviderAuthError || err instanceof ProviderRateLimitError) return err;
    const status = err.status ?? null;
    const headers = err.response?.headers;
    const remaining = headerValue(headers, 'x-ratelimit-remaining');
    const retryAfter = headerValue(headers, 'retry-after');
    if ((status === 403 || status === 429) && (remaining === '0' || retryAfter !== undefined)) {
      const resetAt =
        retryAfter !== undefined
          ? new Date(Date.now() + Number(retryAfter) * 1000)
          : (this.stats.rateLimitResetAt ?? new Date(Date.now() + 60 * 60_000));
      return new ProviderRateLimitError(
        resetAt,
        remaining === undefined ? null : Number(remaining),
      );
    }
    if (status === 401) return new ProviderAuthError('TOKEN_REVOKED');
    if (status === 404) return new ProviderNotFoundError('resource');
    return new ProviderUnavailableError(`GitHub request failed (${status ?? 'network'})`, status);
  }

  private async graphql<T extends RateLimitInfo>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{ data: T; errors: NonNullable<GraphQLResponse<T>['errors']> }> {
    const response = await this.octokit.request('POST /graphql', { query, variables });
    const body = response.data as GraphQLResponse<T>;
    const errors = body.errors ?? [];
    if (body.data?.rateLimit) {
      this.stats.graphqlPoints += body.data.rateLimit.cost;
      this.stats.rateLimitRemaining = body.data.rateLimit.remaining;
      this.stats.rateLimitResetAt = new Date(body.data.rateLimit.resetAt);
    }
    if (!body.data) {
      if (errors.some((e) => e.type === 'RATE_LIMITED')) {
        throw new ProviderRateLimitError(
          this.stats.rateLimitResetAt ?? new Date(Date.now() + 3_600_000),
          0,
        );
      }
      throw new ProviderUnavailableError(`GitHub GraphQL error: ${errors[0]?.type ?? 'unknown'}`);
    }
    return { data: body.data, errors };
  }

  async getAccount(): Promise<ProviderAccount> {
    const { data } = await this.octokit.request('GET /user');
    const user = data as {
      node_id: string;
      login: string;
      name: string | null;
      avatar_url: string | null;
    };
    return {
      externalId: user.node_id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
    };
  }

  async listInstallations(): Promise<NormalizedInstallation[]> {
    const { data } = await this.octokit.request('GET /user/installations', { per_page: 100 });
    const body = data as {
      installations: {
        id: number;
        account: { login: string; type: string } | null;
        repository_selection: string;
        suspended_at: string | null;
      }[];
    };
    return body.installations.map((inst) => ({
      installationId: String(inst.id),
      accountLogin: inst.account?.login ?? 'unknown',
      accountType: inst.account?.type === 'Organization' ? 'Organization' : 'User',
      repositorySelection: inst.repository_selection === 'selected' ? 'selected' : 'all',
      suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
    }));
  }

  async listRepositories(installations: NormalizedInstallation[]): Promise<NormalizedRepository[]> {
    const repos: NormalizedRepository[] = [];
    for (const inst of installations) {
      if (inst.suspendedAt) continue;
      for (let page = 1; ; page++) {
        let data: unknown;
        try {
          ({ data } = await this.octokit.request(
            'GET /user/installations/{installation_id}/repositories',
            {
              installation_id: Number(inst.installationId),
              per_page: 100,
              page,
            },
          ));
        } catch (error) {
          if (error instanceof ProviderNotFoundError) break; // installation removed meanwhile
          throw error;
        }
        const body = data as { total_count: number; repositories: RestRepository[] };
        repos.push(...body.repositories.map((r) => restRepository(r, inst.installationId)));
        if (page * 100 >= body.total_count || body.repositories.length === 0) break;
      }
    }
    return repos;
  }

  /** Paged search; splits the window while the result count exceeds the 1,000 cap. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- N names the node shape the caller's GraphQL document selects (an unchecked cast of the response).
  private async *search<N extends object>(
    query: string,
    q: (range: string) => string,
    window: TimeWindow,
    extra: Record<string, unknown>,
  ): AsyncGenerator<{ nodes: N[]; total: number }> {
    const windows: [Date, Date][] = [[window.from, window.to]];
    for (let next = windows.shift(); next; next = windows.shift()) {
      const [from, to] = next;
      let after: string | null = null;
      let first = true;
      for (;;) {
        const variables: Record<string, unknown> = {
          q: q(searchRange(from, to)),
          first: SEARCH_PAGE_SIZE,
          after,
          ...extra,
        };
        const response = await this.graphql<SearchResult<N>>(query, variables);
        const result: SearchResult<N>['search'] = response.data.search;
        const { issueCount, pageInfo, nodes } = result;
        if (
          first &&
          issueCount > SEARCH_RESULT_CAP &&
          to.getTime() - from.getTime() > MIN_SPLIT_MS
        ) {
          windows.unshift(...splitWindow(from, to));
          break;
        }
        first = false;
        yield {
          nodes: nodes.filter((n): n is N => n !== null && Object.keys(n).length > 0),
          total: Math.min(issueCount, SEARCH_RESULT_CAP),
        };
        if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
        after = pageInfo.endCursor;
      }
    }
  }

  async *authoredPullRequests(
    login: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedPullRequest>> {
    for await (const page of this.search<GqlPullRequest>(
      AUTHORED_SEARCH,
      (range) => `is:pr author:${login} updated:${range}`,
      window,
      {},
    )) {
      yield { items: page.nodes.map(mapAuthoredPullRequest), total: page.total };
    }
  }

  async *reviewedPullRequests(
    login: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedReviewedPullRequest>> {
    for await (const page of this.search<GqlPullRequest>(
      REVIEWED_SEARCH,
      (range) => `is:pr reviewed-by:${login} -author:${login} updated:${range}`,
      window,
      { login },
    )) {
      yield { items: page.nodes.map((n) => mapReviewedPullRequest(n, login)), total: page.total };
    }
  }

  /** Repositories with commits in the window (`contributionsCollection`, ≤ 1-year spans). */
  async commitRepositories(login: string, window: TimeWindow): Promise<CommitRepositoryActivity[]> {
    const byRepo = new Map<string, CommitRepositoryActivity>();
    for (let from = window.from.getTime(); from < window.to.getTime(); from += YEAR_MS) {
      const to = Math.min(from + YEAR_MS, window.to.getTime());
      const { data } = await this.graphql<
        RateLimitInfo & {
          user: {
            contributionsCollection: {
              commitContributionsByRepository: {
                contributions: { totalCount: number };
                repository: GqlRepository;
              }[];
            };
          } | null;
        }
      >(COMMIT_REPOSITORIES, {
        login,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      for (const entry of data.user?.contributionsCollection.commitContributionsByRepository ??
        []) {
        const existing = byRepo.get(entry.repository.id);
        if (existing) existing.commitCount += entry.contributions.totalCount;
        else
          byRepo.set(entry.repository.id, {
            repository: mapRepository(entry.repository),
            commitCount: entry.contributions.totalCount,
          });
      }
    }
    return [...byRepo.values()];
  }

  /** Default-branch history for many repositories, batched with aliases, paged per repository. */
  async *commits(authorExternalId: string, requests: CommitRequest[]): AsyncIterable<CommitPage> {
    let pending = requests.map((request) => ({ request, after: null as string | null }));
    while (pending.length > 0) {
      const batch = pending.slice(0, COMMIT_BATCH_SIZE);
      pending = pending.slice(COMMIT_BATCH_SIZE);
      const variables: Record<string, unknown> = { author: authorExternalId };
      batch.forEach(({ request, after }, i) => {
        variables[`o${i}`] = request.repository.ownerLogin;
        variables[`n${i}`] = request.repository.name;
        variables[`s${i}`] = request.since.toISOString();
        variables[`u${i}`] = request.until.toISOString();
        variables[`a${i}`] = after;
      });
      const { data } = await this.graphql<RateLimitInfo & Record<string, GqlHistoryRepo | null>>(
        commitHistoryQuery(batch.length),
        variables,
      );
      for (const [i, item] of batch.entries()) {
        const node = data[`r${i}`] as GqlHistoryRepo | null | undefined;
        const externalId = item.request.repository.externalId;
        if (!node) {
          yield {
            repositoryExternalId: externalId,
            branch: null,
            items: [],
            done: true,
            notFound: true,
          };
          continue;
        }
        const branch = node.defaultBranchRef?.name ?? null;
        const history = node.defaultBranchRef?.target?.history;
        if (!branch || !history) {
          yield { repositoryExternalId: externalId, branch, items: [], done: true };
          continue;
        }
        const more = history.pageInfo.hasNextPage && history.pageInfo.endCursor;
        yield {
          repositoryExternalId: externalId,
          branch,
          items: history.nodes.map((c) => mapCommit(c, externalId, branch)),
          done: !more,
        };
        if (more) pending.push({ request: item.request, after: history.pageInfo.endCursor });
      }
    }
  }

  async pullRequest(login: string, repositoryFullName: string, number: number) {
    const [owner, name] = repositoryFullName.split('/');
    const { data } = await this.graphql<
      RateLimitInfo & { repository: { pullRequest: GqlPullRequest | null } | null }
    >(SINGLE_PR, { owner, name, number, login });
    const node = data.repository?.pullRequest;
    if (!node) return null;
    if ((node.author?.login ?? '').toLowerCase() === login.toLowerCase()) {
      return { role: 'authored' as const, pullRequest: mapAuthoredPullRequest(node) };
    }
    return { role: 'reviewed' as const, reviewed: mapReviewedPullRequest(node, login, 'requests') };
  }
}

interface GqlHistoryRepo {
  id: string;
  defaultBranchRef: {
    name: string;
    target: {
      history?: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GqlCommit[];
      };
    } | null;
  } | null;
}

interface RestRepository {
  node_id: string;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  fork: boolean;
  archived: boolean;
  html_url: string;
  default_branch: string;
}

function restRepository(r: RestRepository, installationId: string | null): NormalizedRepository {
  return {
    externalId: r.node_id,
    fullName: r.full_name,
    ownerLogin: r.owner.login,
    name: r.name,
    isPrivate: r.private,
    isFork: r.fork,
    isArchived: r.archived,
    defaultBranch: r.default_branch || null,
    htmlUrl: r.html_url || null,
    installationId,
  };
}

/** `ActivityProvider` for GitHub (ADR-0004/0007). */
@Injectable()
export class GitHubProvider implements ActivityProvider {
  readonly kind = 'github' as const;
  private readonly logger = new Logger(GitHubProvider.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly appAuth: GitHubAppAuth,
  ) {}

  openSession(options: ProviderSessionOptions): ProviderSession {
    return new GitHubSession(
      this.config.get('GITHUB_API_URL', { infer: true }),
      options,
      this.config.get('GITHUB_REQUEST_RETRIES', { infer: true }),
      this.config.get('GITHUB_THROTTLING', { infer: true }),
    );
  }

  refreshToken(refreshToken: string): Promise<ProviderTokenSet> {
    return this.appAuth.refreshUserToken(refreshToken);
  }

  revokeToken(accessToken: string): Promise<boolean> {
    return this.appAuth.revokeUserToken(accessToken);
  }

  async installationRepositories(installationId: string): Promise<NormalizedRepository[]> {
    const token = await this.appAuth.installationToken(installationId);
    const repos: NormalizedRepository[] = [];
    for (let page = 1; ; page++) {
      const url = new URL('/installation/repositories', this.appAuth.apiBase);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const res = await this.appAuth.request(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok)
        throw new ProviderUnavailableError('Could not list installation repositories', res.status);
      const body = (await res.json()) as { total_count: number; repositories: RestRepository[] };
      repos.push(...body.repositories.map((r) => restRepository(r, installationId)));
      if (page * 100 >= body.total_count || body.repositories.length === 0) break;
    }
    return repos;
  }

  verifyWebhook(rawBody: Uint8Array, signatureHeader: string | undefined): boolean {
    return verifyGitHubSignature(
      this.config.get('GITHUB_WEBHOOK_SECRET', { infer: true }),
      rawBody,
      signatureHeader,
    );
  }

  parseWebhook(event: string, payload: unknown): ProviderWebhookEvent {
    return parseGitHubWebhook(event, payload);
  }
}
