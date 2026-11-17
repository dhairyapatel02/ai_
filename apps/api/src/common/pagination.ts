import { AppException } from './app-exception';

import type { PageMeta } from '@devimpact/shared';

/**
 * Opaque keyset cursor (ADR-0006): base64url JSON of the last row's sort key `{ t, id }`.
 * Rows are ordered by `(timestamp DESC, id DESC)`, so the next page is
 * `timestamp < t OR (timestamp = t AND id < id)` — stable while sync inserts new rows.
 */
export interface CursorKey {
  t: string;
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorKey).t === 'string' &&
      typeof (parsed as CursorKey).id === 'string' &&
      !Number.isNaN(Date.parse((parsed as CursorKey).t))
    ) {
      return parsed as CursorKey;
    }
  } catch {
    // fall through
  }
  throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
    issues: [{ path: 'query.cursor', message: 'Invalid cursor', code: 'invalid_cursor' }],
  });
}

/** Prisma `where` fragment for the page after `key` on a `(field DESC, id DESC)` ordering. */
export function afterCursor(field: string, key: CursorKey | undefined) {
  if (!key) return {};
  const t = new Date(key.t);
  return {
    OR: [{ [field]: { lt: t } }, { [field]: t, id: { lt: key.id } }],
  } as Record<string, unknown>;
}

/**
 * Turns `limit + 1` fetched rows into a page and its meta. `timeOf` extracts the sort timestamp.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  timeOf: (row: T) => Date,
  total?: number,
): { items: T[]; meta: PageMeta } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    meta: {
      nextCursor:
        hasMore && last ? encodeCursor({ t: timeOf(last).toISOString(), id: last.id }) : null,
      hasMore,
      ...(total === undefined ? {} : { total }),
    },
  };
}

/** Opaque offset cursor (base64url `{ o }`) for lists ordered by a non-time key. */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) {
      return parsed.o;
    }
  } catch {
    // fall through
  }
  throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
    issues: [{ path: 'query.cursor', message: 'Invalid cursor', code: 'invalid_cursor' }],
  });
}
