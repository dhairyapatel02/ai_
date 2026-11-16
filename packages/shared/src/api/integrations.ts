import { z } from 'zod';

import { Id, IntegrationStatus, QueryBoolean, Timestamp } from './common';

/** API_CONTRACT_V2 §3.5 / §6. Tokens are never part of any DTO. */
export const InstallationDto = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
  accountType: z.enum(['User', 'Organization']),
  repositorySelection: z.enum(['all', 'selected']),
  suspended: z.boolean(),
});
export type InstallationDto = z.infer<typeof InstallationDto>;

export const IntegrationDto = z.object({
  id: Id,
  provider: z.literal('github'),
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

export const ConnectReturnTo = z.enum(['/onboarding', '/settings/integrations', '/connect']);

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

export const DisconnectQuery = z.strictObject({ purgeData: QueryBoolean.default(false) });
export type DisconnectQuery = z.infer<typeof DisconnectQuery>;

export const DisconnectResult = z.object({
  integrationId: Id,
  status: z.literal('disconnected'),
  purged: z.boolean(),
  tokenRevoked: z.boolean(),
});
export type DisconnectResult = z.infer<typeof DisconnectResult>;
