import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderHttp, retryAfter, tokenRequest, toTokenSet, verifyHmacHex } from '../http';
import { ProviderUnavailableError } from '../provider.errors';
import {
  detectStoryPointsField,
  jqlFor,
  mapJiraIssue,
  type JiraField,
  type JiraIssue,
  type JiraSite,
} from './mappers';

import type { Env } from '../../config/env';
import type {
  IssueTrackerProvider,
  IssueTrackerSession,
  NormalizedIssue,
  OAuthAuthorizeRequest,
  OAuthExchangeRequest,
  ProviderAccount,
  ProviderOAuthClient,
  ProviderSessionOptions,
  ProviderTokenSet,
  ProviderWebhookEvent,
  SearchPage,
  TimeWindow,
} from '@devimpact/shared';

const SCOPES = 'read:jira-work read:jira-user offline_access';
const PAGE = 50;
const MAX_SITES = 10;

/** Jira answers 429 with `Retry-After`; it reports no remaining budget on success. */
const readJiraRateLimit = (headers: Headers) => ({
  remaining: null,
  resetAt: headers.get('retry-after') ? retryAfter(headers) : null,
});

interface AtlassianMe {
  account_id: string;
  email?: string | null;
  name?: string | null;
  nickname?: string | null;
  picture?: string | null;
}

/** Jira Cloud OAuth 2.0 (3LO). Atlassian does not offer PKCE: signed single-use state + secret. */
@Injectable()
export class JiraOAuthClient implements ProviderOAuthClient {
  readonly kind = 'jira' as const;
  readonly usesPkce = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get auth() {
    return this.config.get('JIRA_AUTH_URL', { infer: true });
  }

  private get timeoutMs() {
    return this.config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true });
  }

  configured(): boolean {
    return !!(
      this.config.get('JIRA_CLIENT_ID', { infer: true }) &&
      this.config.get('JIRA_CLIENT_SECRET', { infer: true })
    );
  }

  private credentials() {
    const id = this.config.get('JIRA_CLIENT_ID', { infer: true });
    const secret = this.config.get('JIRA_CLIENT_SECRET', { infer: true });
    if (!id || !secret) throw new ProviderUnavailableError('Jira is not configured');
    return { id, secret };
  }

  authorizeUrl(request: OAuthAuthorizeRequest): string {
    const url = new URL('/authorize', this.auth);
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', this.credentials().id);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('redirect_uri', request.redirectUri);
    url.searchParams.set('state', request.state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async exchangeCode(request: OAuthExchangeRequest): Promise<ProviderTokenSet> {
    const { id, secret } = this.credentials();
    const res = await tokenRequest(
      new URL('/oauth/token', this.auth).toString(),
      {
        grant_type: 'authorization_code',
        client_id: id,
        client_secret: secret,
        code: request.code,
        redirect_uri: request.redirectUri,
      },
      { json: true, timeoutMs: this.timeoutMs, label: 'Jira' },
    );
    return toTokenSet(res, 'Jira');
  }

  async refresh(refreshToken: string): Promise<ProviderTokenSet> {
    const { id, secret } = this.credentials();
    const res = await tokenRequest(
      new URL('/oauth/token', this.auth).toString(),
      {
        grant_type: 'refresh_token',
        client_id: id,
        client_secret: secret,
        refresh_token: refreshToken,
      },
      { json: true, timeoutMs: this.timeoutMs, label: 'Jira' },
    );
    return toTokenSet(res, 'Jira');
  }

  async account(accessToken: string): Promise<ProviderAccount> {
    const http = new ProviderHttp({
      label: 'Jira',
      getAccessToken: () => Promise.resolve(accessToken),
      onUnauthorized: () => Promise.resolve(null),
      retries: 1,
      timeoutMs: this.timeoutMs,
      readRateLimit: readJiraRateLimit,
    });
    return jiraAccount(http, this.config.get('JIRA_API_URL', { infer: true }));
  }

  manageUrl(): string {
    return 'https://id.atlassian.com/manage-profile/apps';
  }

  callbackUrl(): string {
    return `${this.config.get('WEB_URL', { infer: true })}/integrations/jira/callback`;
  }
}

async function jiraAccount(http: ProviderHttp, api: string): Promise<ProviderAccount> {
  const { data } = await http.get<AtlassianMe>(`${api}/me`);
  return {
    externalId: data.account_id,
    login: data.nickname ?? data.name ?? data.account_id,
    name: data.name ?? null,
    avatarUrl: data.picture ?? null,
    // Atlassian account emails are verified by Atlassian.
    verifiedEmails: data.email ? [data.email.toLowerCase()] : [],
  };
}

class JiraSession implements IssueTrackerSession {
  private readonly http: ProviderHttp;
  private sites: JiraSite[] = [];
  private readonly categories = new Map<string, Map<string, string>>();
  private readonly pointsField = new Map<string, string | null>();

  constructor(
    private readonly api: string,
    private readonly options: ProviderSessionOptions,
    settings: { retries: number; timeoutMs: number },
  ) {
    this.http = new ProviderHttp({
      label: 'Jira',
      getAccessToken: options.getAccessToken,
      onUnauthorized: options.onUnauthorized,
      minRemaining: options.minRemaining,
      retries: settings.retries,
      timeoutMs: settings.timeoutMs,
      readRateLimit: readJiraRateLimit,
    });
  }

  get stats() {
    return this.http.stats;
  }

  getAccount(): Promise<ProviderAccount> {
    return jiraAccount(this.http, this.api);
  }

  /** Accessible sites, their status categories and the story points field of each site. */
  async prepare(): Promise<Record<string, unknown>> {
    const { data } = await this.http.get<
      { id: string; name: string; url: string; scopes?: string[] }[]
    >(`${this.api}/oauth/token/accessible-resources`);
    this.sites = (data ?? [])
      .filter((s) => !s.scopes || s.scopes.includes('read:jira-work'))
      .slice(0, MAX_SITES)
      .map((s) => ({ id: s.id, name: s.name, url: s.url }));
    const override =
      typeof this.options.config?.storyPointsField === 'string'
        ? this.options.config.storyPointsField
        : null;
    const detected: Record<string, string | null> = {};
    for (const site of this.sites) {
      const base = `${this.api}/ex/jira/${encodeURIComponent(site.id)}/rest/api/3`;
      const [statuses, fields] = await Promise.all([
        this.http.get<{ id: string; statusCategory?: { key?: string } }[]>(`${base}/status`),
        this.http.get<JiraField[]>(`${base}/field`),
      ]);
      this.categories.set(
        site.id,
        new Map((statuses.data ?? []).map((s) => [s.id, s.statusCategory?.key ?? 'new'])),
      );
      detected[site.id] = detectStoryPointsField(fields.data ?? []);
      this.pointsField.set(site.id, override ?? detected[site.id]);
    }
    return {
      sites: this.sites,
      storyPointsField: override,
      storyPointsFieldDetected: Object.values(detected).find((v) => v) ?? null,
      storyPointsFieldBySite: detected,
    };
  }

  async *issues(
    accountExternalId: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedIssue>> {
    if (this.sites.length === 0) await this.prepare();
    for (const site of this.sites) {
      const field = this.pointsField.get(site.id) ?? null;
      const categories = this.categories.get(site.id) ?? new Map<string, string>();
      const jql = jqlFor(accountExternalId, window);
      let nextPageToken: string | undefined;
      for (;;) {
        const res = await this.http.request<{
          issues?: JiraIssue[];
          nextPageToken?: string;
          isLast?: boolean;
          errorMessages?: string[];
        }>({
          method: 'POST',
          url: `${this.api}/ex/jira/${encodeURIComponent(site.id)}/rest/api/3/search/jql`,
          json: {
            jql,
            maxResults: PAGE,
            fields: [
              'summary',
              'status',
              'priority',
              'labels',
              'project',
              'created',
              'updated',
              'resolutiondate',
              'statuscategorychangedate',
              'resolution',
              'assignee',
              ...(field ? [field] : []),
            ],
            expand: 'changelog',
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        });
        if (res.status === 400) {
          throw new ProviderUnavailableError('Jira rejected the issue search', 400);
        }
        const items = (res.data.issues ?? []).map((issue) =>
          mapJiraIssue(issue, { site, storyPointsField: field, categories }),
        );
        const last = res.data.isLast !== false || !res.data.nextPageToken;
        yield { items, total: items.length + (last ? 0 : PAGE) };
        if (last) break;
        nextPageToken = res.data.nextPageToken;
      }
    }
  }
}

/** `IssueTrackerProvider` for Jira Cloud (P13). */
@Injectable()
export class JiraProvider implements IssueTrackerProvider {
  readonly kind = 'jira' as const;
  readonly category = 'issues' as const;

  constructor(
    private readonly oauth: JiraOAuthClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  openSession(options: ProviderSessionOptions): IssueTrackerSession {
    return new JiraSession(this.config.get('JIRA_API_URL', { infer: true }), options, {
      retries: this.config.get('PROVIDER_REQUEST_RETRIES', { infer: true }),
      timeoutMs: this.config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true }),
    });
  }

  refreshToken(refreshToken: string): Promise<ProviderTokenSet> {
    return this.oauth.refresh(refreshToken);
  }

  /** Atlassian 3LO has no revocation endpoint; the user removes access at id.atlassian.com. */
  revokeToken(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /** Jira Cloud webhook secret: `X-Hub-Signature: sha256=<hex HMAC-SHA256>`. */
  verifyWebhook(rawBody: Uint8Array, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    return verifyHmacHex(
      this.config.get('JIRA_WEBHOOK_SECRET', { infer: true }),
      rawBody,
      signatureHeader.slice('sha256='.length),
    );
  }

  parseWebhook(event: string, payload: unknown): ProviderWebhookEvent {
    return parseJiraWebhook(event, payload);
  }
}

/** `jira:issue_*` → `activity_changed` for the assignee(s) before/after; the rest → ignored. */
export function parseJiraWebhook(event: string, payload: unknown): ProviderWebhookEvent {
  if (!/^jira:issue_(created|updated|deleted)$/.test(event)) {
    return { kind: 'ignored', reason: `event ${event}` };
  }
  const body = (payload && typeof payload === 'object' ? payload : {}) as {
    issue?: { self?: unknown; fields?: { assignee?: { accountId?: unknown } | null } };
    changelog?: { items?: { field?: unknown; from?: unknown; to?: unknown }[] };
  };
  const accounts = new Set<string>();
  const assignee = body.issue?.fields?.assignee?.accountId;
  if (typeof assignee === 'string') accounts.add(assignee);
  for (const item of body.changelog?.items ?? []) {
    if (item.field !== 'assignee') continue;
    for (const v of [item.from, item.to]) if (typeof v === 'string' && v !== '') accounts.add(v);
  }
  let site: string | null = null;
  if (typeof body.issue?.self === 'string') {
    try {
      site = new URL(body.issue.self).origin;
    } catch {
      site = null;
    }
  }
  if (accounts.size === 0) return { kind: 'ignored', reason: 'unassigned issue' };
  return {
    kind: 'activity_changed',
    provider: 'jira',
    accountExternalIds: [...accounts],
    repositoryExternalIds: [],
    siteId: site,
  };
}
