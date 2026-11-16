import type { SyncCounts, SyncRunDto, SyncRunError } from '@devimpact/shared';
import type { SyncRun } from '@prisma/client';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Prisma `SyncRun` → wire `SyncRunDto` (lower-case enums, ISO timestamps). */
export function toSyncRunDto(run: SyncRun): SyncRunDto {
  return {
    id: run.id,
    integrationId: run.integrationId,
    trigger: run.trigger.toLowerCase() as SyncRunDto['trigger'],
    kind: run.kind.toLowerCase() as SyncRunDto['kind'],
    status: run.status.toLowerCase() as SyncRunDto['status'],
    stage: run.stage.toLowerCase() as SyncRunDto['stage'],
    progress: run.progress,
    counts: (run.counts ?? {}) as SyncCounts,
    windowFrom: iso(run.windowFrom),
    windowTo: iso(run.windowTo),
    resumeAt: iso(run.resumeAt),
    recentWindowCompletedAt: iso(run.recentWindowCompletedAt),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    errors: (Array.isArray(run.errors) ? run.errors : []) as SyncRunError[],
    queuedAt: run.queuedAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
  };
}

/** Next daily slot (UTC minute of day) strictly after `now` (DATA_MODEL_V2 §4). */
export function nextSlotAfter(slotMinute: number, now: Date): Date {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let at = day + slotMinute * 60_000;
  if (at <= now.getTime()) at += 86_400_000;
  return new Date(at);
}
