import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../common/app-exception';

import type { Env } from '../config/env';

export interface GitHubUserToken {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

export interface GitHubUserProfile {
  id: number;
  nodeId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GitHubInstallationInfo {
  id: number;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repositorySelection: 'all' | 'selected';
  suspendedAt: Date | null;
}

const TIMEOUT_MS = 10_000;

/**
 * Minimal GitHub App OAuth client for the connect flow (ADR-0004). Uses the App's client id and
 * secret; never logs tokens. Sync calls (GraphQL, refresh, installations metadata) are P06.
 * Tests replace this provider — they never call GitHub.
 */
@Injectable()
export class GitHubAppClient {
  private readonly logger = new Logger(GitHubAppClient.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get clientId() {
    return this.config.get('GITHUB_APP_CLIENT_ID', { infer: true });
  }
  private get clientSecret() {
    return this.config.get('GITHUB_APP_CLIENT_SECRET', { infer: true });
  }
  private get webBase() {
    return this.config.get('GITHUB_WEB_URL', { infer: true });
  }
  private get apiBase() {
    return this.config.get('GITHUB_API_URL', { infer: true });
  }

  /** Throws a clear error when the GitHub App isn't configured (local dev on seed data). */
  assertConfigured(): void {
    if (
      !this.clientId ||
      !this.clientSecret ||
      !this.config.get('GITHUB_APP_SLUG', { infer: true })
    ) {
      throw new AppException(
        'UPSTREAM_UNAVAILABLE',
        'GitHub connection is not configured on this server',
        { provider: 'github' },
      );
    }
  }

  installUrl(state: string): string {
    const slug = this.config.get('GITHUB_APP_SLUG', { infer: true }) ?? '';
    const url = new URL(`/apps/${encodeURIComponent(slug)}/installations/new`, this.webBase);
    url.searchParams.set('state', state);
    return url.toString();
  }

  authorizeUrl(state: string, codeChallenge: string, redirectUri: string): string {
    const url = new URL('/login/oauth/authorize', this.webBase);
    url.searchParams.set('client_id', this.clientId ?? '');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  manageUrl(): string {
    const slug = this.config.get('GITHUB_APP_SLUG', { infer: true });
    return slug
      ? new URL(`/apps/${encodeURIComponent(slug)}`, this.webBase).toString()
      : new URL('/settings/installations', this.webBase).toString();
  }

  async exchangeCode(
    code: string,
    codeVerifier: string | undefined,
    redirectUri: string,
  ): Promise<GitHubUserToken> {
    const body: Record<string, string> = {
      client_id: this.clientId ?? '',
      client_secret: this.clientSecret ?? '',
      code,
      redirect_uri: redirectUri,
    };
    if (codeVerifier) body.code_verifier = codeVerifier;
    const res = await this.request(new URL('/login/oauth/access_token', this.webBase), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      error?: string;
    };
    if (!json.access_token) {
      // e.g. bad_verification_code / expired code / redirect mismatch: user must retry.
      this.logger.warn(
        { githubError: json.error ?? `HTTP ${res.status}` },
        'GitHub code exchange failed',
      );
      throw new AppException(
        'OAUTH_DENIED',
        'GitHub did not accept the authorization. Please try connecting again.',
      );
    }
    const now = Date.now();
    return {
      accessToken: json.access_token,
      accessTokenExpiresAt: json.expires_in ? new Date(now + json.expires_in * 1000) : null,
      refreshToken: json.refresh_token ?? null,
      refreshTokenExpiresAt: json.refresh_token_expires_in
        ? new Date(now + json.refresh_token_expires_in * 1000)
        : null,
    };
  }

  async getUser(accessToken: string): Promise<GitHubUserProfile> {
    const json = await this.apiGet<{
      id: number;
      node_id: string;
      login: string;
      name: string | null;
      avatar_url: string | null;
    }>('/user', accessToken);
    return {
      id: json.id,
      nodeId: json.node_id,
      login: json.login,
      name: json.name,
      avatarUrl: json.avatar_url,
    };
  }

  async listInstallations(accessToken: string): Promise<GitHubInstallationInfo[]> {
    const json = await this.apiGet<{
      installations: {
        id: number;
        account: { login: string; type: string } | null;
        repository_selection: string;
        suspended_at: string | null;
      }[];
    }>('/user/installations?per_page=100', accessToken);
    return json.installations.map((inst) => ({
      id: inst.id,
      accountLogin: inst.account?.login ?? 'unknown',
      accountType: inst.account?.type === 'Organization' ? 'Organization' : 'User',
      repositorySelection: inst.repository_selection === 'selected' ? 'selected' : 'all',
      suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
    }));
  }

  /** Revokes a user token (`DELETE /applications/{client_id}/token`). Best effort: never throws. */
  async revokeToken(accessToken: string): Promise<boolean> {
    if (!this.clientId || !this.clientSecret) return false;
    try {
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await this.request(
        new URL(`/applications/${encodeURIComponent(this.clientId)}/token`, this.apiBase),
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: accessToken }),
        },
      );
      // 404 = token already invalid/expired, which is the desired end state.
      return res.status === 204 || res.status === 404;
    } catch {
      return false;
    }
  }

  private async apiGet<T>(path: string, accessToken: string): Promise<T> {
    const res = await this.request(new URL(path, this.apiBase), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      this.logger.warn({ status: res.status, path }, 'GitHub API request failed');
      throw new AppException('UPSTREAM_ERROR', 'GitHub returned an unexpected error', {
        provider: 'github',
      });
    }
    return (await res.json()) as T;
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new AppException('UPSTREAM_UNAVAILABLE', 'GitHub is not reachable right now', {
        provider: 'github',
      });
    }
  }
}
