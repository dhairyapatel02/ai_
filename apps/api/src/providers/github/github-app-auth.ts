import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ProviderAuthError, ProviderUnavailableError } from '../provider.errors';

import type { Env } from '../../config/env';
import type { ProviderTokenSet } from '@devimpact/shared';

const TIMEOUT_MS = 15_000;

interface CachedInstallationToken {
  token: string;
  expiresAt: number;
}

/**
 * GitHub App credentials (ADR-0004): user-token refresh/revoke with the App's client id/secret, and
 * installation tokens signed with the App private key (`GITHUB_APP_PRIVATE_KEY` PEM — raw, with
 * `\n` escapes, or base64 — or `GITHUB_APP_PRIVATE_KEY_FILE`). Never logs token values.
 */
@Injectable()
export class GitHubAppAuth {
  private readonly logger = new Logger(GitHubAppAuth.name);
  private privateKey: KeyObject | null | undefined;
  private readonly installationTokens = new Map<string, CachedInstallationToken>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  private get webBase() {
    return this.config.get('GITHUB_WEB_URL', { infer: true });
  }
  get apiBase(): string {
    return this.config.get('GITHUB_API_URL', { infer: true });
  }
  private get clientId() {
    return this.config.get('GITHUB_APP_CLIENT_ID', { infer: true });
  }
  private get clientSecret() {
    return this.config.get('GITHUB_APP_CLIENT_SECRET', { infer: true });
  }

  /** `grant_type=refresh_token` (expiring user tokens: 8 h access, 6 months refresh). */
  async refreshUserToken(refreshToken: string): Promise<ProviderTokenSet> {
    if (!this.clientId || !this.clientSecret) throw new ProviderAuthError('REFRESH_FAILED');
    const res = await this.request(new URL('/login/oauth/access_token', this.webBase), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (res.status >= 500)
      throw new ProviderUnavailableError('GitHub token endpoint failed', res.status);
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      error?: string;
    };
    if (!json.access_token) {
      // bad_refresh_token / expired refresh token / app authorization revoked.
      this.logger.warn(
        { githubError: json.error ?? `HTTP ${res.status}` },
        'GitHub token refresh failed',
      );
      throw new ProviderAuthError('REFRESH_FAILED');
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

  /** `DELETE /applications/{client_id}/token`. Best effort: never throws. */
  async revokeUserToken(accessToken: string): Promise<boolean> {
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
      return res.status === 204 || res.status === 404;
    } catch {
      return false;
    }
  }

  private loadPrivateKey(): KeyObject | null {
    if (this.privateKey !== undefined) return this.privateKey;
    const file = this.config.get('GITHUB_APP_PRIVATE_KEY_FILE', { infer: true });
    let pem = file
      ? readFileSync(file, 'utf8')
      : (this.config.get('GITHUB_APP_PRIVATE_KEY', { infer: true }) ?? '');
    pem = pem.trim();
    if (pem && !pem.includes('-----BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
    pem = pem.replace(/\\n/g, '\n');
    this.privateKey = pem ? createPrivateKey(pem) : null;
    return this.privateKey;
  }

  /** RS256 App JWT (iat − 60 s for clock drift, 9-minute lifetime; GitHub allows ≤ 10). */
  appJwt(now = Date.now()): string {
    const key = this.loadPrivateKey();
    const appId = this.config.get('GITHUB_APP_ID', { infer: true });
    if (!key || !appId)
      throw new ProviderUnavailableError('GitHub App private key is not configured');
    const seconds = Math.floor(now / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: appId })}`;
    const signature = createSign('RSA-SHA256').update(body).sign(key).toString('base64url');
    return `${body}.${signature}`;
  }

  /** Installation access token (1 h), cached until 5 minutes before expiry. */
  async installationToken(installationId: string): Promise<string> {
    const cached = this.installationTokens.get(installationId);
    if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;
    const res = await this.request(
      new URL(
        `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
        this.apiBase,
      ),
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.appJwt()}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!res.ok) {
      throw new ProviderUnavailableError(
        'Could not create a GitHub installation token',
        res.status,
      );
    }
    const json = (await res.json()) as { token: string; expires_at: string };
    this.installationTokens.set(installationId, {
      token: json.token,
      expiresAt: Date.parse(json.expires_at),
    });
    return json.token;
  }

  async request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ProviderUnavailableError('GitHub is not reachable right now');
    }
  }
}
