import type { SyncRunDto, SyncStatusDto } from '@devimpact/shared';

const ID = 'cmabcdefghijklmnopqrstuvw';
const RUN_ID = 'cmzyxwvutsrqponmlkjihgfed';

export function syncRun(overrides: Partial<SyncRunDto> = {}): SyncRunDto {
  return {
    id: RUN_ID,
    integrationId: ID,
    trigger: 'initial',
    kind: 'backfill',
    status: 'running',
    stage: 'authored_prs',
    progress: 40,
    counts: { repos: 5, prsAuthored: 12 },
    windowFrom: null,
    windowTo: null,
    resumeAt: null,
    recentWindowCompletedAt: null,
    errorCode: null,
    errorMessage: null,
    errors: [],
    queuedAt: '2026-11-18T09:00:00.000Z',
    startedAt: '2026-11-18T09:00:01.000Z',
    finishedAt: null,
    ...overrides,
  };
}

export function syncStatus(overrides: Partial<SyncStatusDto> = {}): SyncStatusDto {
  return {
    integrationId: ID,
    state: 'idle',
    currentRun: null,
    lastRun: null,
    lastSuccessfulAt: null,
    nextScheduledAt: null,
    ...overrides,
  };
}

/** A `Response` with the D-006 success envelope. */
export function okJson(data: unknown, init: { status?: number; meta?: unknown } = {}): Response {
  return new Response(JSON.stringify({ success: true, data, meta: init.meta }), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function errJson(
  status: number,
  code: string,
  extra: { details?: unknown; headers?: Record<string, string> } = {},
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code, message: `${code} message`, details: extra.details, requestId: 'req-123' },
    }),
    { status, headers: { 'content-type': 'application/json', ...extra.headers } },
  );
}
