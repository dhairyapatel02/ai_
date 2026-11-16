import { nextSlotAfter } from '../sync/sync-run.mapper';

import type { IntegrationDto, IntegrationStatus, IntegrationSummary } from '@devimpact/shared';
import type { GitHubInstallation, Integration, Prisma } from '@prisma/client';

/**
 * Columns any read path may select. Token columns are deliberately absent (ADR-0005): they are
 * only read by `IntegrationsService` for revocation and by the GitHub provider at call time.
 */
export const SAFE_INTEGRATION_SELECT = {
  id: true,
  userId: true,
  provider: true,
  mechanism: true,
  externalAccountId: true,
  externalLogin: true,
  displayName: true,
  avatarUrl: true,
  status: true,
  statusReason: true,
  backfillFrom: true,
  lastSyncedAt: true,
  lastSuccessfulSyncAt: true,
  scheduleSlotMinute: true,
  createdAt: true,
  installations: true,
} satisfies Prisma.IntegrationSelect;

export type SafeIntegration = Pick<
  Integration,
  | 'id'
  | 'userId'
  | 'provider'
  | 'mechanism'
  | 'externalAccountId'
  | 'externalLogin'
  | 'displayName'
  | 'avatarUrl'
  | 'status'
  | 'statusReason'
  | 'backfillFrom'
  | 'lastSyncedAt'
  | 'lastSuccessfulSyncAt'
  | 'scheduleSlotMinute'
  | 'createdAt'
> & { installations: GitHubInstallation[] };

export const toWireStatus = (status: Integration['status']) =>
  status.toLowerCase() as IntegrationStatus;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toIntegrationDto(
  row: SafeIntegration,
  manageUrl: string,
  now = new Date(),
): IntegrationDto {
  return {
    id: row.id,
    provider: 'github',
    status: toWireStatus(row.status),
    statusReason: row.statusReason,
    externalLogin: row.externalLogin,
    displayName: row.displayName,
    avatarUrl: safeUrl(row.avatarUrl),
    installations: row.installations.map((inst) => ({
      installationId: inst.installationId.toString(),
      accountLogin: inst.accountLogin,
      accountType: inst.accountType === 'Organization' ? 'Organization' : 'User',
      repositorySelection: inst.repositorySelection === 'selected' ? 'selected' : 'all',
      suspended: inst.suspendedAt !== null,
    })),
    manageUrl,
    lastSyncedAt: iso(row.lastSyncedAt),
    lastSuccessfulSyncAt: iso(row.lastSuccessfulSyncAt),
    // Daily jittered slot of the hourly fan-out; paused unless ACTIVE (ADR-0007).
    nextScheduledSyncAt:
      row.status === 'ACTIVE' ? nextSlotAfter(row.scheduleSlotMinute, now).toISOString() : null,
    backfillFrom: iso(row.backfillFrom),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toIntegrationSummary(
  row: Pick<Integration, 'id' | 'status' | 'externalLogin' | 'lastSuccessfulSyncAt'>,
): IntegrationSummary {
  return {
    id: row.id,
    provider: 'github',
    status: toWireStatus(row.status),
    externalLogin: row.externalLogin,
    lastSuccessfulSyncAt: iso(row.lastSuccessfulSyncAt),
  };
}

/** Daily sync slot: stable hash of the id mod 1440 (DATA_MODEL_V2 §4). */
export function scheduleSlotFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 1440;
}
