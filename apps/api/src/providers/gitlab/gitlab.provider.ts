import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderHttp, safeEqual, tokenRequest, toTokenSet, type RateLimitReading } from '../http';
import { ProviderNotFoundError, ProviderUnavailableError } from '../provider.errors';
import { type GitLabInstance, parseGitLabInstances, originOf } from './instances';
import {
  analyzeNotes,
  glId,
  hostOf,
  mapCommit,
  mapMergeRequest,
  mapProject,
  numericId,
  type GlCommit,
  type GlMergeRequest,
  type GlNote,
  type GlProject,
} from './mappers';

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
  OAuthAuthorizeRequest,
  OAuthExchangeRequest,
  ProviderAccount,
  ProviderOAuthClient,
  ProviderSession,
  ProviderSessionOptions,
  ProviderTokenSet,
  ProviderWebhookEvent,
  SearchPage,
  TimeWindow,
} from '@devimpact/shared';

const PAGE = 50;
const SCOPES = 'read_api read_user';
/** Project list cap (membership): beyond it repositories are discovered from activity. */
const MAX_PROJECT_PAGES = 20;

function readGitLabRateLimit(headers: Headers): RateLimitReading {
  const remaining = headers.get('ratelimit-remaining');
  const reset = headers.get('ratelimit-reset');
  return {
    remaining: remaining !== null && remaining !== '' ? Number(remaining) : null,
    resetAt: reset ? new Date(Number(reset) * 1000) : null,
  };
}

interface GlUserProfile {
  id: number;
  username: string;
  name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  commit_email?: string | null;
}

/** GitLab instances (gitlab.com or self-managed) and their OAuth applications (D-030). */
@Injectable()
export class GitLabInstances {
  private readonly all: GitLabInstance[];

  constructor(config: ConfigService<Env, true>) {
    const list: GitLabInstance[] = [];
    const id = config.get('GITLAB_CLIENT_ID', { infer: true });
    const secret = config.get('GITLAB_CLIENT_SECRET', { infer: true });
    const url = originOf(config.get('GITLAB_URL', { infer: true }));
    if (id && secret && url) {
      list.push({
        url,
        clientId: id,
        clientSecret: secret,
        label: url === 'https://gitlab.com' ? 'GitLab.com' : new URL(url).host,
      });
    }
    const extra = parseGitLabInstances(config.get('GITLAB_INSTANCES_JSON', { infer: true }));
    if (extra.ok)
      for (const inst of extra.instances)
        if (!list.some((i) => i.url === inst.url)) list.push(inst);
    this.all = list;
  }

  list(): GitLabInstance[] {
    return this.all;
  }

  /** The configured instance for `baseUrl` (null/undefined = the default); null if not allow-listed. */
  resolve(baseUrl?: string | null): GitLabInstance | null {
    if (!baseUrl) return this.all[0] ?? null;
    const origin = originOf(baseUrl);
    return this.all.find((i) => i.url === origin) ?? null;
  }

  require(baseUrl?: string | null): GitLabInstance {
    const instance = this.resolve(baseUrl);
    if (!instance) throw new ProviderUnavailableError('GitLab is not configured for this instance');
    return instance;
  }
}

/** GitLab OAuth (authorization code + PKCE S256, refresh tokens; ARCHITECTURE_V2 §5). */
@Injectable()
export class GitLabOAuthClient implements ProviderOAuthClient {
  readonly kind = 'gitlab' as const;
  readonly usesPkce = true;

  constructor(
    private readonly instances: GitLabInstances,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get timeoutMs() {
    return this.config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true });
  }

  configured(): boolean {
    return this.instances.list().length > 0;
  }

  authorizeUrl(request: OAuthAuthorizeRequest): string {
    const instance = this.instances.require(request.baseUrl);
    const url = new URL('/oauth/authorize', instance.url);
    url.searchParams.set('client_id', instance.clientId);
    url.searchParams.set('redirect_uri', request.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('state', request.state);
    url.searchParams.set('code_challenge', request.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(request: OAuthExchangeRequest): Promise<ProviderTokenSet> {
    const instance = this.instances.require(request.baseUrl);
    const res = await tokenRequest(
      new URL('/oauth/token', instance.url).toString(),
      {
        grant_type: 'authorization_code',
        client_id: instance.clientId,
        client_secret: instance.clientSecret,
        code: request.code,
        redirect_uri: request.redirectUri,
        code_verifier: request.codeVerifier,
      },
      { timeoutMs: this.timeoutMs, label: 'GitLab' },
    );
    return toTokenSet(res, 'GitLab');
  }

  async account(accessToken: string, baseUrl?: string | null): Promise<ProviderAccount> {
    const instance = this.instances.require(baseUrl);
    const http = new ProviderHttp({
      label: 'GitLab',
      getAccessToken: () => Promise.resolve(accessToken),
      onUnauthorized: () => Promise.resolve(null),
      retries: 1,
      timeoutMs: this.timeoutMs,
      readRateLimit: readGitLabRateLimit,
    });
    return gitlabAccount(http, `${instance.url}/api/v4`, hostOf(instance.url));
  }

  manageUrl(baseUrl?: string | null): string {
    const instance = this.instances.resolve(baseUrl);
    return `${instance?.url ?? 'https://gitlab.com'}/-/user_settings/applications`;
  }

  callbackUrl(): string {
    return `${this.config.get('WEB_URL', { infer: true })}/integrations/gitlab/callback`;
  }
}

async function gitlabAccount(
  http: ProviderHttp,
  api: string,
  host: string,
): Promise<ProviderAccount> {
  const { data: user } = await http.get<GlUserProfile>(`${api}/user`);
  const emails = new Set<string>();
  // The primary email of a GitLab account is confirmed; `/user/emails` lists the secondary ones.
  if (user.email) emails.add(user.email.toLowerCase());
  if (user.commit_email) emails.add(user.commit_email.toLowerCase());
  try {
    const { data } = await http.get<{ email: string; confirmed_at?: string | null }[]>(
      `${api}/user/emails`,
    );
    for (const e of data ?? []) if (e.confirmed_at && e.email) emails.add(e.email.toLowerCase());
  } catch (error) {
    if (!(error instanceof ProviderNotFoundError)) throw error;
  }
  return {
    externalId: glId(host, '', user.id),
    login: user.username,
    name: user.name ?? null,
    avatarUrl: user.avatar_url ?? null,
    verifiedEmails: [...emails],
  };
}

class GitLabSession implements ProviderSession {
  private readonly http: ProviderHttp;
  private readonly api: string;
  private readonly host: string;
  private readonly projects = new Map<number, NormalizedRepository>();
  private userId: number | null = null;
  private username: string | null = null;

  constructor(
    baseUrl: string,
    private readonly options: ProviderSessionOptions,
    settings: { retries: number; timeoutMs: number },
  ) {
    this.api = `${baseUrl}/api/v4`;
    this.host = hostOf(baseUrl);
    this.http = new ProviderHttp({
      label: 'GitLab',
      getAccessToken: options.getAccessToken,
      onUnauthorized: options.onUnauthorized,
      minRemaining: options.minRemaining,
      retries: settings.retries,
      timeoutMs: settings.timeoutMs,
      readRateLimit: readGitLabRateLimit,
    });
  }

  get stats() {
    return this.http.stats;
  }

  private url(path: string, params: Record<string, string | number | undefined> = {}): URL {
    const url = new URL(`${this.api}${path}`);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) url.searchParams.set(k, String(v));
    return url;
  }

  async getAccount(): Promise<ProviderAccount> {
    const account = await gitlabAccount(this.http, this.api, this.host);
    this.userId = numericId(account.externalId);
    this.username = account.login;
    return account;
  }

  private async me(login: string): Promise<{ id: number | null; username: string }> {
    if (this.userId === null) {
      const { data } = await this.http.get<GlUserProfile>(`${this.api}/user`);
      this.userId = data.id;
      this.username = data.username;
    }
    return { id: this.userId, username: this.username ?? login };
  }

  listInstallations(): Promise<NormalizedInstallation[]> {
    return Promise.resolve([]); // GitLab has no App installations: access = project membership
  }

  async listRepositories(): Promise<NormalizedRepository[]> {
    const repos: NormalizedRepository[] = [];
    for (let page = 1; page <= MAX_PROJECT_PAGES; page++) {
      const { data, headers } = await this.http.get<GlProject[]>(
        this.url('/projects', {
          membership: 'true',
          min_access_level: 20,
          order_by: 'last_activity_at',
          per_page: 100,
          page,
        }),
      );
      for (const p of data ?? []) {
        const repo = mapProject(p, this.host);
        this.projects.set(p.id, repo);
        repos.push(repo);
      }
      if (!headers.get('x-next-page')) break;
    }
    return repos;
  }

  private async project(id: number): Promise<NormalizedRepository | null> {
    const cached = this.projects.get(id);
    if (cached) return cached;
    try {
      const { data } = await this.http.get<GlProject>(this.url(`/projects/${id}`));
      const repo = mapProject(data, this.host);
      this.projects.set(id, repo);
      return repo;
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }

  private async notes(projectId: number, iid: number): Promise<GlNote[]> {
    try {
      const { data } = await this.http.get<GlNote[]>(
        this.url(`/projects/${projectId}/merge_requests/${iid}/notes`, {
          sort: 'asc',
          order_by: 'created_at',
          per_page: 100,
        }),
      );
      return data ?? [];
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return [];
      throw error;
    }
  }

  private async *mergeRequests(
    params: Record<string, string>,
    window: TimeWindow,
  ): AsyncIterable<{ items: GlMergeRequest[]; total: number }> {
    for (let page = 1; ; page++) {
      const { data, headers } = await this.http.get<GlMergeRequest[]>(
        this.url('/merge_requests', {
          scope: 'all',
          ...params,
          updated_after: window.from.toISOString(),
          updated_before: window.to.toISOString(),
          order_by: 'updated_at',
          sort: 'asc',
          per_page: PAGE,
          page,
        }),
      );
      const total = Number(headers.get('x-total') ?? (data ?? []).length);
      yield { items: data ?? [], total: Number.isFinite(total) ? total : PAGE };
      if (!headers.get('x-next-page') || (data ?? []).length < PAGE) return;
    }
  }

  async *authoredPullRequests(
    login: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedPullRequest>> {
    const me = await this.me(login);
    for await (const page of this.mergeRequests({ author_username: me.username }, window)) {
      const items: NormalizedPullRequest[] = [];
      for (const mr of page.items) {
        const repo = await this.project(mr.project_id);
        if (!repo) continue;
        const notes = analyzeNotes(await this.notes(mr.project_id, mr.iid), {
          host: this.host,
          mrId: mr.id,
          authorId: mr.author.id,
          userId: me.id,
          username: me.username,
        });
        items.push(mapMergeRequest(mr, repo, { host: this.host, authored: true, notes }));
      }
      yield { items, total: page.total };
    }
  }

  async *reviewedPullRequests(
    login: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedReviewedPullRequest>> {
    const me = await this.me(login);
    for await (const page of this.mergeRequests({ reviewer_username: me.username }, window)) {
      const items: NormalizedReviewedPullRequest[] = [];
      for (const mr of page.items) {
        if (mr.author.id === me.id) continue; // own MRs are authored, never reviewed (DATA-01)
        const repo = await this.project(mr.project_id);
        if (!repo) continue;
        const notes = analyzeNotes(await this.notes(mr.project_id, mr.iid), {
          host: this.host,
          mrId: mr.id,
          authorId: mr.author.id,
          userId: me.id,
          username: me.username,
        });
        if (notes.myReviews.length === 0) continue; // requested but not reviewed yet
        items.push({
          pullRequest: mapMergeRequest(mr, repo, { host: this.host, authored: false, notes: null }),
          reviews: notes.myReviews,
        });
      }
      yield { items, total: page.total };
    }
  }

  async commitRepositories(login: string, window: TimeWindow): Promise<CommitRepositoryActivity[]> {
    const me = await this.me(login);
    const counts = new Map<number, number>();
    const day = (d: Date, offset: number) =>
      new Date(d.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    for (let page = 1; page <= 20; page++) {
      const { data, headers } = await this.http.get<
        { project_id: number; push_data?: { commit_count?: number } | null }[]
      >(
        this.url(`/users/${me.id}/events`, {
          action: 'pushed',
          after: day(window.from, -1),
          before: day(window.to, 1),
          per_page: 100,
          page,
        }),
      );
      for (const e of data ?? []) {
        counts.set(
          e.project_id,
          (counts.get(e.project_id) ?? 0) + (e.push_data?.commit_count ?? 1),
        );
      }
      if (!headers.get('x-next-page')) break;
    }
    const result: CommitRepositoryActivity[] = [];
    for (const [id, commitCount] of counts) {
      const repository = await this.project(id);
      if (repository) result.push({ repository, commitCount });
    }
    return result;
  }

  async *commits(authorExternalId: string, requests: CommitRequest[]): AsyncIterable<CommitPage> {
    const emails = [
      ...new Set((this.options.identities?.emails ?? []).map((e) => e.toLowerCase())),
    ];
    for (const request of requests) {
      const repo = request.repository;
      const projectId = numericId(repo.externalId);
      const branch = repo.defaultBranch ?? null;
      if (projectId === null) continue;
      if (emails.length === 0) {
        yield { repositoryExternalId: repo.externalId, branch, items: [], done: true };
        continue;
      }
      const seen = new Set<string>();
      try {
        for (const [index, email] of emails.entries()) {
          for (let page = 1; ; page++) {
            const { data, headers } = await this.http.get<GlCommit[]>(
              this.url(`/projects/${projectId}/repository/commits`, {
                ...(branch ? { ref_name: branch } : {}),
                since: request.since.toISOString(),
                until: request.until.toISOString(),
                author: email,
                with_stats: 'true',
                per_page: 100,
                page,
              }),
            );
            // `author` is a substring search on name/email: keep exact email matches only.
            const items = (data ?? [])
              .filter((c) => c.author_email?.toLowerCase() === email && !seen.has(c.id))
              .map((c) => {
                seen.add(c.id);
                return mapCommit(c, repo.externalId, branch ?? 'HEAD', authorExternalId);
              });
            const last = !headers.get('x-next-page') || (data ?? []).length < 100;
            yield {
              repositoryExternalId: repo.externalId,
              branch,
              items,
              done: last && index === emails.length - 1,
            };
            if (last) break;
          }
        }
      } catch (error) {
        if (!(error instanceof ProviderNotFoundError)) throw error;
        yield {
          repositoryExternalId: repo.externalId,
          branch,
          items: [],
          done: true,
          notFound: true,
        };
      }
    }
  }

  async pullRequest(
    login: string,
    repositoryFullName: string,
    number: number,
  ): Promise<
    | { role: 'authored'; pullRequest: NormalizedPullRequest }
    | { role: 'reviewed'; reviewed: NormalizedReviewedPullRequest }
    | null
  > {
    const me = await this.me(login);
    try {
      const encoded = encodeURIComponent(repositoryFullName);
      const { data: mr } = await this.http.get<GlMergeRequest>(
        this.url(`/projects/${encoded}/merge_requests/${number}`),
      );
      const repo = await this.project(mr.project_id);
      if (!repo) return null;
      const notes = analyzeNotes(await this.notes(mr.project_id, mr.iid), {
        host: this.host,
        mrId: mr.id,
        authorId: mr.author.id,
        userId: me.id,
        username: me.username,
      });
      if (mr.author.id === me.id) {
        return {
          role: 'authored',
          pullRequest: mapMergeRequest(mr, repo, { host: this.host, authored: true, notes }),
        };
      }
      if (notes.myReviews.length === 0) return null;
      return {
        role: 'reviewed',
        reviewed: {
          pullRequest: mapMergeRequest(mr, repo, { host: this.host, authored: false, notes: null }),
          reviews: notes.myReviews,
        },
      };
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }
}

/** `ActivityProvider` for GitLab (gitlab.com + allow-listed self-managed instances). */
@Injectable()
export class GitLabProvider implements ActivityProvider {
  readonly kind = 'gitlab' as const;
  readonly category = 'code' as const;

  constructor(
    private readonly instances: GitLabInstances,
    private readonly oauth: GitLabOAuthClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private settings() {
    return {
      retries: this.config.get('PROVIDER_REQUEST_RETRIES', { infer: true }),
      timeoutMs: this.config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true }),
    };
  }

  openSession(options: ProviderSessionOptions): ProviderSession {
    const instance = this.instances.require(options.baseUrl);
    return new GitLabSession(instance.url, options, this.settings());
  }

  async refreshToken(refreshToken: string, baseUrl?: string | null): Promise<ProviderTokenSet> {
    const instance = this.instances.require(baseUrl);
    const res = await tokenRequest(
      new URL('/oauth/token', instance.url).toString(),
      {
        grant_type: 'refresh_token',
        client_id: instance.clientId,
        client_secret: instance.clientSecret,
        refresh_token: refreshToken,
        redirect_uri: this.oauth.callbackUrl(),
      },
      { timeoutMs: this.settings().timeoutMs, label: 'GitLab' },
    );
    return toTokenSet(res, 'GitLab');
  }

  async revokeToken(accessToken: string, baseUrl?: string | null): Promise<boolean> {
    const instance = this.instances.resolve(baseUrl);
    if (!instance) return false;
    const res = await tokenRequest(
      new URL('/oauth/revoke', instance.url).toString(),
      { client_id: instance.clientId, client_secret: instance.clientSecret, token: accessToken },
      { timeoutMs: this.settings().timeoutMs, label: 'GitLab' },
    );
    return res.status === 200;
  }

  installationRepositories(): Promise<NormalizedRepository[]> {
    return Promise.resolve([]);
  }

  /** `X-Gitlab-Token` must equal GITLAB_WEBHOOK_SECRET (constant time; fails closed). */
  verifyWebhook(_rawBody: Uint8Array, signatureHeader: string | undefined): boolean {
    return safeEqual(signatureHeader, this.config.get('GITLAB_WEBHOOK_SECRET', { infer: true }));
  }

  parseWebhook(event: string, payload: unknown): ProviderWebhookEvent {
    return parseGitLabWebhook(event, payload);
  }
}

const HANDLED_EVENTS = new Set(['Merge Request Hook', 'Note Hook', 'Push Hook']);

/** Normalises GitLab project/group webhooks to `activity_changed` (others → ignored). */
export function parseGitLabWebhook(event: string, payload: unknown): ProviderWebhookEvent {
  if (!HANDLED_EVENTS.has(event)) return { kind: 'ignored', reason: `event ${event}` };
  const body = (payload && typeof payload === 'object' ? payload : {}) as {
    project?: { id?: unknown; web_url?: unknown };
    user?: { id?: unknown };
    user_id?: unknown;
    object_attributes?: { author_id?: unknown };
    merge_request?: { author_id?: unknown };
  };
  const projectId = body.project?.id;
  const webUrl = body.project?.web_url;
  if (typeof projectId !== 'number' || typeof webUrl !== 'string') {
    return { kind: 'ignored', reason: 'no project' };
  }
  let host: string;
  try {
    host = new URL(webUrl).host;
  } catch {
    return { kind: 'ignored', reason: 'bad project url' };
  }
  const accounts = [
    body.user?.id,
    body.user_id,
    body.object_attributes?.author_id,
    body.merge_request?.author_id,
  ]
    .filter((v): v is number => typeof v === 'number')
    .map((id) => glId(host, '', id));
  return {
    kind: 'activity_changed',
    provider: 'gitlab',
    accountExternalIds: [...new Set(accounts)],
    repositoryExternalIds: [glId(host, '', projectId)],
    siteId: null,
  };
}
