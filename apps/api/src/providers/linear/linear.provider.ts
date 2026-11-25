import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderHttp, tokenRequest, toTokenSet, verifyHmacHex } from '../http';
import {
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from '../provider.errors';
import {
  LINEAR_ISSUES_QUERY,
  LINEAR_VIEWER_QUERY,
  mapLinearIssue,
  type LinearIssueNode,
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

/** Replay window for signed Linear webhooks (`webhookTimestamp`, ms). */
export const LINEAR_WEBHOOK_TOLERANCE_MS = 60_000;

function readLinearRateLimit(headers: Headers) {
  const remaining = headers.get('x-ratelimit-requests-remaining');
  const reset = headers.get('x-ratelimit-requests-reset');
  return {
    remaining: remaining !== null && remaining !== '' ? Number(remaining) : null,
    resetAt: reset ? new Date(Number(reset)) : null,
  };
}

interface Viewer {
  id: string;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  organization?: { id: string; name: string; urlKey: string } | null;
}

/** GraphQL over `ProviderHttp`: Linear reports rate limits and auth errors in `errors[]`. */
async function graphql<T>(
  http: ProviderHttp,
  api: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await http.request<{
    data?: T;
    errors?: { message?: string; extensions?: { code?: string } }[];
  }>({ method: 'POST', url: `${api}/graphql`, json: { query, variables } });
  const errors = res.data?.errors ?? [];
  const code = errors[0]?.extensions?.code;
  if (code === 'RATELIMITED') {
    throw new ProviderRateLimitError(
      http.stats.rateLimitResetAt ?? new Date(Date.now() + 60_000),
      0,
    );
  }
  if (code === 'AUTHENTICATION_ERROR' || code === 'FORBIDDEN')
    throw new ProviderAuthError('TOKEN_REVOKED');
  if (errors.length > 0 || !res.data?.data) {
    throw new ProviderUnavailableError('Linear rejected the query', res.status);
  }
  return res.data.data;
}

/** Linear OAuth (authorization code + PKCE S256; refresh tokens where Linear issues them). */
@Injectable()
export class LinearOAuthClient implements ProviderOAuthClient {
  readonly kind = 'linear' as const;
  readonly usesPkce = true;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get timeoutMs() {
    return this.config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true });
  }

  private get api() {
    return this.config.get('LINEAR_API_URL', { infer: true });
  }

  configured(): boolean {
    return !!(
      this.config.get('LINEAR_CLIENT_ID', { infer: true }) &&
      this.config.get('LINEAR_CLIENT_SECRET', { infer: true })
    );
  }

  private credentials() {
    const id = this.config.get('LINEAR_CLIENT_ID', { infer: true });
    const secret = this.config.get('LINEAR_CLIENT_SECRET', { infer: true });
    if (!id || !secret) throw new ProviderUnavailableError('Linear is not configured');
    return { id, secret };
  }

  authorizeUrl(request: OAuthAuthorizeRequest): string {
    const url = new URL('/oauth/authorize', this.config.get('LINEAR_WEB_URL', { infer: true }));
    url.searchParams.set('client_id', this.credentials().id);
    url.searchParams.set('redirect_uri', request.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'read');
    url.searchParams.set('state', request.state);
    url.searchParams.set('code_challenge', request.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async exchangeCode(request: OAuthExchangeRequest): Promise<ProviderTokenSet> {
    const { id, secret } = this.credentials();
    const res = await tokenRequest(
      new URL('/oauth/token', this.api).toString(),
      {
        grant_type: 'authorization_code',
        client_id: id,
        client_secret: secret,
        code: request.code,
        redirect_uri: request.redirectUri,
        code_verifier: request.codeVerifier,
      },
      { timeoutMs: this.timeoutMs, label: 'Linear' },
    );
    return toTokenSet(res, 'Linear');
  }

  async refresh(refreshToken: string): Promise<ProviderTokenSet> {
    const { id, secret } = this.credentials();
    const res = await tokenRequest(
      new URL('/oauth/token', this.api).toString(),
      {
        grant_type: 'refresh_token',
        client_id: id,
        client_secret: secret,
        refresh_token: refreshToken,
      },
      { timeoutMs: this.timeoutMs, label: 'Linear' },
    );
    return toTokenSet(res, 'Linear');
  }

  async revoke(accessToken: string): Promise<boolean> {
    try {
      const res = await fetch(new URL('/oauth/revoke', this.api), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async account(accessToken: string): Promise<ProviderAccount> {
    const http = new ProviderHttp({
      label: 'Linear',
      getAccessToken: () => Promise.resolve(accessToken),
      onUnauthorized: () => Promise.resolve(null),
      retries: 1,
      timeoutMs: this.timeoutMs,
      readRateLimit: readLinearRateLimit,
    });
    return (await linearViewer(http, this.api)).account;
  }

  manageUrl(): string {
    return `${this.config.get('LINEAR_WEB_URL', { infer: true })}/settings/account/security`;
  }

  callbackUrl(): string {
    return `${this.config.get('WEB_URL', { infer: true })}/integrations/linear/callback`;
  }
}

async function linearViewer(
  http: ProviderHttp,
  api: string,
): Promise<{ account: ProviderAccount; organization: Viewer['organization'] }> {
  const { viewer } = await graphql<{ viewer: Viewer }>(http, api, LINEAR_VIEWER_QUERY);
  return {
    account: {
      externalId: viewer.id,
      login: viewer.displayName ?? viewer.name ?? viewer.id,
      name: viewer.name ?? null,
      avatarUrl: viewer.avatarUrl ?? null,
      verifiedEmails: viewer.email ? [viewer.email.toLowerCase()] : [],
    },
    organization: viewer.organization ?? null,
  };
}

class LinearSession implements IssueTrackerSession {
  private readonly http: ProviderHttp;
  private organizationId: string | null;

  constructor(
    private readonly api: string,
    options: ProviderSessionOptions,
    settings: { retries: number; timeoutMs: number },
  ) {
    const org = options.config?.organization as { id?: string } | undefined;
    this.organizationId = org?.id ?? null;
    this.http = new ProviderHttp({
      label: 'Linear',
      getAccessToken: options.getAccessToken,
      onUnauthorized: options.onUnauthorized,
      minRemaining: options.minRemaining,
      retries: settings.retries,
      timeoutMs: settings.timeoutMs,
      readRateLimit: readLinearRateLimit,
    });
  }

  get stats() {
    return this.http.stats;
  }

  async getAccount(): Promise<ProviderAccount> {
    return (await linearViewer(this.http, this.api)).account;
  }

  async prepare(): Promise<Record<string, unknown>> {
    const { organization } = await linearViewer(this.http, this.api);
    this.organizationId = organization?.id ?? null;
    return organization ? { organization } : {};
  }

  async *issues(
    accountExternalId: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedIssue>> {
    let after: string | null = null;
    for (;;) {
      const data: {
        issues: {
          nodes: LinearIssueNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await graphql(this.http, this.api, LINEAR_ISSUES_QUERY, {
        assignee: accountExternalId,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        after,
      });
      const items = data.issues.nodes.map((n) => mapLinearIssue(n, this.organizationId));
      const more = data.issues.pageInfo.hasNextPage && !!data.issues.pageInfo.endCursor;
      yield { items, total: items.length + (more ? 50 : 0) };
      if (!more) return;
      after = data.issues.pageInfo.endCursor;
    }
  }
}

/** `IssueTrackerProvider` for Linear (P13). */
@Injectable()
export class LinearProvider implements IssueTrackerProvider {
  readonly kind = 'linear' as const;
  readonly category = 'issues' as const;

  constructor(
    private readonly oauth: LinearOAuthClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  openSession(options: ProviderSessionOptions): IssueTrackerSession {
    return new LinearSession(this.config.get('LINEAR_API_URL', { infer: true }), options, {
      retries: this.config.get('PROVIDER_REQUEST_RETRIES', { infer: true }),
      timeoutMs: this.config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true }),
    });
  }

  refreshToken(refreshToken: string): Promise<ProviderTokenSet> {
    return this.oauth.refresh(refreshToken);
  }

  revokeToken(accessToken: string): Promise<boolean> {
    return this.oauth.revoke(accessToken);
  }

  /**
   * `Linear-Signature` = hex HMAC-SHA256(secret, raw body); then `webhookTimestamp` must be within
   * 60 s of now (replay protection on top of delivery-id idempotency).
   */
  verifyWebhook(
    rawBody: Uint8Array,
    signatureHeader: string | undefined,
    now = Date.now(),
  ): boolean {
    if (
      !verifyHmacHex(
        this.config.get('LINEAR_WEBHOOK_SECRET', { infer: true }),
        rawBody,
        signatureHeader,
      )
    ) {
      return false;
    }
    try {
      const ts = (
        JSON.parse(Buffer.from(rawBody).toString('utf8')) as { webhookTimestamp?: unknown }
      ).webhookTimestamp;
      return typeof ts === 'number' && Math.abs(now - ts) <= LINEAR_WEBHOOK_TOLERANCE_MS;
    } catch {
      return false;
    }
  }

  parseWebhook(event: string, payload: unknown): ProviderWebhookEvent {
    return parseLinearWebhook(event, payload);
  }
}

/** `Issue` create/update/remove → `activity_changed` for the old/new assignee; else ignored. */
export function parseLinearWebhook(event: string, payload: unknown): ProviderWebhookEvent {
  const body = (payload && typeof payload === 'object' ? payload : {}) as {
    type?: unknown;
    organizationId?: unknown;
    data?: { assigneeId?: unknown };
    updatedFrom?: { assigneeId?: unknown };
  };
  if (event !== 'Issue' || body.type !== 'Issue')
    return { kind: 'ignored', reason: `event ${event}` };
  const accounts = [body.data?.assigneeId, body.updatedFrom?.assigneeId].filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  if (accounts.length === 0) return { kind: 'ignored', reason: 'unassigned issue' };
  return {
    kind: 'activity_changed',
    provider: 'linear',
    accountExternalIds: [...new Set(accounts)],
    repositoryExternalIds: [],
    siteId: typeof body.organizationId === 'string' ? body.organizationId : null,
  };
}
