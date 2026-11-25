import { z } from 'zod';

import { Id, IntegrationStatus, ProviderWire, QueryBoolean, Timestamp } from './common';
import { SyncRunDto } from './sync';

/** API_CONTRACT_V2 §3.5 / §6. Tokens are never part of any DTO. */
export const InstallationDto = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
  accountType: z.enum(['User', 'Organization']),
  repositorySelection: z.enum(['all', 'selected']),
  suspended: z.boolean(),
});
export type InstallationDto = z.infer<typeof InstallationDto>;

/** Jira Cloud site the integration reads (accessible resources). */
export const JiraSiteDto = z.object({ id: z.string(), name: z.string(), url: z.url() });
export type JiraSiteDto = z.infer<typeof JiraSiteDto>;

export const IntegrationDto = z.object({
  id: Id,
  provider: ProviderWire,
  /** `code` = repositories/PRs/commits (GitHub, GitLab); `issues` = Jira, Linear (P13). */
  category: z.enum(['code', 'issues']).default('code'),
  /** Self-managed GitLab origin; null = provider default (P13). */
  baseUrl: z.url().nullable().default(null),
  /** Jira: sites read + the story points field in use (detected or chosen). Linear: workspace. */
  settings: z
    .object({
      sites: z.array(JiraSiteDto).optional(),
      storyPointsField: z.string().nullable().optional(),
      storyPointsFieldDetected: z.string().nullable().optional(),
      workspace: z.object({ id: z.string(), name: z.string(), urlKey: z.string() }).optional(),
    })
    .default({}),
  status: IntegrationStatus,
  statusReason: z.string().nullable(),
  externalLogin: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  installations: z.array(InstallationDto),
  manageUrl: z.url(),
  lastSyncedAt: Timestamp.nullable(),
  lastSuccessfulSyncAt: Timestamp.nullable(),
  nextScheduledSyncAt: Timestamp.nullable(),
  backfillFrom: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type IntegrationDto = z.infer<typeof IntegrationDto>;

/** Where the GitHub callback returns to (IA §2: onboarding or Settings → Integrations). */
export const ConnectReturnTo = z.enum(['/onboarding', '/settings/integrations']);
export type ConnectReturnTo = z.infer<typeof ConnectReturnTo>;

export const ConnectGitHubInput = z.strictObject({ returnTo: ConnectReturnTo.optional() });
export type ConnectGitHubInput = z.infer<typeof ConnectGitHubInput>;

export const ConnectGitHubResult = z.object({
  url: z.url(),
  mode: z.enum(['install', 'authorize']),
  expiresAt: Timestamp,
});
export type ConnectGitHubResult = z.infer<typeof ConnectGitHubResult>;

/**
 * `POST /integrations/github/callback`. The web callback page forwards GitHub's query string:
 * `code`, `state`, `installation_id`, `setup_action`, or `error` when the user cancelled.
 * `code` may be absent only for `setupAction: 'request'` (org approval pending) or an `error`.
 */
export const GitHubCallbackInput = z
  .strictObject({
    code: z.string().min(1).max(200).optional(),
    state: z.string().min(1).max(1024),
    installationId: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    setupAction: z.enum(['install', 'update', 'request']).optional(),
    error: z.string().max(100).optional(),
    errorDescription: z.string().max(500).optional(),
  })
  .refine((v) => v.code !== undefined || v.error !== undefined || v.setupAction === 'request', {
    message: 'code is required',
    path: ['code'],
  });
export type GitHubCallbackInput = z.infer<typeof GitHubCallbackInput>;

/** `GET /integrations/:id`. */
export const IntegrationDetail = IntegrationDto.extend({ currentRun: SyncRunDto.nullable() });
export type IntegrationDetail = z.infer<typeof IntegrationDetail>;

// ── GitLab / Jira / Linear OAuth (P13, API_CONTRACT_V2 §22 A-8) ────────────────────────────────

export const OAuthProviderWire = z.enum(['gitlab', 'jira', 'linear']);
export type OAuthProviderWire = z.infer<typeof OAuthProviderWire>;
export const ProviderParams = z.strictObject({ provider: OAuthProviderWire });

/** `https://host[:port]` only — no path, query, credentials or fragment (SSRF guard, D-030). */
export const SelfManagedBaseUrl = z
  .url({ protocol: /^https$/ })
  .max(200)
  .refine(
    (value) => {
      try {
        const u = new URL(value);
        return (
          u.username === '' &&
          u.password === '' &&
          (u.pathname === '/' || u.pathname === '') &&
          u.search === '' &&
          u.hash === ''
        );
      } catch {
        return false;
      }
    },
    { message: 'Use the instance origin, e.g. https://gitlab.example.com' },
  );

/** `POST /integrations/:provider/connect`. `baseUrl` = self-managed GitLab (allow-listed). */
export const ConnectProviderInput = z.strictObject({
  returnTo: ConnectReturnTo.optional(),
  baseUrl: SelfManagedBaseUrl.optional(),
});
export type ConnectProviderInput = z.infer<typeof ConnectProviderInput>;

export const ConnectProviderResult = z.object({
  url: z.url(),
  mode: z.literal('authorize'),
  expiresAt: Timestamp,
});
export type ConnectProviderResult = z.infer<typeof ConnectProviderResult>;

/** `POST /integrations/:provider/callback` — the web callback page forwards `code` + `state`. */
export const ProviderCallbackInput = z
  .strictObject({
    code: z.string().min(1).max(2048).optional(),
    state: z.string().min(1).max(1024),
    error: z.string().max(100).optional(),
    errorDescription: z.string().max(500).optional(),
  })
  .refine((v) => v.code !== undefined || v.error !== undefined, {
    message: 'code is required',
    path: ['code'],
  });
export type ProviderCallbackInput = z.infer<typeof ProviderCallbackInput>;

export const ProviderCallbackResult = z.object({
  integration: IntegrationDto,
  syncRun: SyncRunDto,
  returnTo: z.string().nullable(),
});
export type ProviderCallbackResult = z.infer<typeof ProviderCallbackResult>;

/** `PATCH /integrations/:id` (P13): Jira story points field override (`null` = auto-detect). */
export const UpdateIntegrationInput = z.strictObject({
  storyPointsField: z
    .string()
    .regex(/^customfield_\d{1,10}$/)
    .nullable()
    .optional(),
});
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationInput>;

// ── Identity linking (P13, D-030) ──────────────────────────────────────────────────────────

export const IdentityDto = z.object({
  id: Id,
  integrationId: Id,
  provider: ProviderWire,
  kind: z.enum(['account', 'username', 'email']),
  value: z.string(),
  source: z.enum(['provider', 'manual']),
  verified: z.boolean(),
  createdAt: Timestamp,
});
export type IdentityDto = z.infer<typeof IdentityDto>;

export const AddIdentityInput = z.strictObject({
  email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
});
export type AddIdentityInput = z.infer<typeof AddIdentityInput>;

export const IdentityParams = z.strictObject({ id: Id, identityId: Id });

/**
 * `POST /integrations/github/callback` result: `201` connected (backfill queued) or `200` org
 * approval pending (`setupAction=request`). `returnTo` comes from the signed state; clients still
 * check it against `ConnectReturnTo` before navigating.
 */
export const GitHubCallbackConnected = z.object({
  integration: IntegrationDto,
  syncRun: SyncRunDto,
  returnTo: z.string().nullable(),
});
export const GitHubCallbackPending = z.object({
  integration: IntegrationDto.nullable(),
  pendingApproval: z.literal(true),
  returnTo: z.string().nullable(),
});
export const GitHubCallbackResult = z.union([GitHubCallbackPending, GitHubCallbackConnected]);
export type GitHubCallbackResult = z.infer<typeof GitHubCallbackResult>;

export const DisconnectQuery = z.strictObject({ purgeData: QueryBoolean.default(false) });
export type DisconnectQuery = z.infer<typeof DisconnectQuery>;

export const DisconnectResult = z.object({
  integrationId: Id,
  status: z.literal('disconnected'),
  purged: z.boolean(),
  tokenRevoked: z.boolean(),
});
export type DisconnectResult = z.infer<typeof DisconnectResult>;
