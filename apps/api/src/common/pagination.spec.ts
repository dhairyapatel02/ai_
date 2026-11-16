import { afterCursor, decodeCursor, encodeCursor, toPage } from './pagination';

describe('cursor pagination helpers', () => {
  it('round-trips an opaque base64url cursor', () => {
    const key = { t: '2026-10-01T10:00:00.000Z', id: 'cabc' };
    const cursor = encodeCursor(key);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(key);
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it('rejects tampered cursors with VALIDATION_FAILED', () => {
    expect(() => decodeCursor('bm90LWpzb24')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() =>
      decodeCursor(Buffer.from('{"t":"nope","id":"x"}').toString('base64url')),
    ).toThrow();
  });

  it('builds a keyset filter on (field DESC, id DESC)', () => {
    expect(afterCursor('timestamp', undefined)).toEqual({});
    const t = new Date('2026-10-01T10:00:00.000Z');
    expect(afterCursor('timestamp', { t: t.toISOString(), id: 'c2' })).toEqual({
      OR: [{ timestamp: { lt: t } }, { timestamp: t, id: { lt: 'c2' } }],
    });
  });

  it('pages limit+1 rows into items and meta', () => {
    const rows = [3, 2, 1].map((d) => ({ id: `c${d}`, at: new Date(`2026-10-0${d}T00:00:00Z`) }));
    const first = toPage(rows, 2, (r) => r.at, 3);
    expect(first.items.map((r) => r.id)).toEqual(['c3', 'c2']);
    expect(first.meta).toMatchObject({ hasMore: true, total: 3 });
    expect(decodeCursor(first.meta.nextCursor ?? undefined)).toEqual({
      t: '2026-10-02T00:00:00.000Z',
      id: 'c2',
    });
    expect(toPage(rows.slice(2), 2, (r) => r.at).meta).toEqual({
      nextCursor: null,
      hasMore: false,
    });
  });
});
