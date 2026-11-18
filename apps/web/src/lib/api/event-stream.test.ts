import { describe, expect, it, vi } from 'vitest';

import { errJson } from '../../../test/fixtures';
import { parseDocumentEvent, readEventStream, SseParser, type SseMessage } from './event-stream';

/** The P08 contract example (PROGRESS.md, Phase 08 handoff), split at awkward places. */
const STREAM = [
  'id: 1794914000000-0\nevent: status\ndata: {"status":"pending","version":1}\n\n',
  ': heartbeat\n\n',
  'id: 1794914003112-0\nevent: delta\ndata: {"key":"summary","text":"Backend eng',
  'ineer"}\n\nid: 1794914003530-0\r\nevent: section\r\ndata: {"key":"summary","index":0,"content":{"text":"…","citations":["PR-acme/payments#100"]}}\r\n\r\n',
  'id: 1794914009870-0\nevent: done\ndata: {"documentId":"cmabcdefghijklmnopqrstuvw","version":1,"citationCoverage":1,"flags":{"uncited":0,"invalid":0}}\n\n',
];

function streamResponse(chunks: string[], status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

describe('SseParser', () => {
  it('parses ids, events and data across chunk boundaries; ignores heartbeats', () => {
    const parser = new SseParser();
    const out = STREAM.flatMap((c) => parser.feed(c));
    expect(out.map((m) => m.event)).toEqual(['status', 'delta', 'section', 'done']);
    expect(out[1]).toEqual({
      id: '1794914003112-0',
      event: 'delta',
      data: '{"key":"summary","text":"Backend engineer"}',
    });
  });

  it('joins multi-line data', () => {
    expect(new SseParser().feed('data: a\ndata: b\n\n')).toEqual([
      { id: null, event: 'message', data: 'a\nb' },
    ]);
  });
});

describe('parseDocumentEvent', () => {
  it('validates events with the shared DocumentStreamEvents schemas', () => {
    const msg = (event: string, data: string): SseMessage => ({ id: '1', event, data });
    expect(parseDocumentEvent(msg('status', '{"status":"streaming","version":2}'))).toEqual({
      event: 'status',
      data: { status: 'streaming', version: 2 },
    });
    expect(
      parseDocumentEvent(msg('error', '{"code":"OUTPUT_INVALID","message":"x","retryable":false}')),
    ).toMatchObject({ event: 'error' });
    expect(parseDocumentEvent(msg('status', '{"status":"nope"}'))).toBeNull();
    expect(parseDocumentEvent(msg('toString', '{}'))).toBeNull();
    expect(parseDocumentEvent(msg('delta', 'not json'))).toBeNull();
  });
});

describe('readEventStream', () => {
  it('sends Authorization + Last-Event-ID with fetch (not EventSource) and emits messages', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(streamResponse(STREAM));
    const seen: string[] = [];
    await readEventStream({
      path: '/documents/cm1/stream',
      baseUrl: 'https://api.test/api',
      lastEventId: '1794914000000-0',
      getToken: () => Promise.resolve('jwt'),
      fetchImpl,
      onMessage: (m) => seen.push(m.event),
    });
    expect(seen).toEqual(['status', 'delta', 'section', 'done']);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/api/documents/cm1/stream');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer jwt',
      'Last-Event-ID': '1794914000000-0',
      Accept: 'text/event-stream',
    });
  });

  it('refreshes the token once on 401 and surfaces HTTP errors as ApiError', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errJson(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce(errJson(429, 'RATE_LIMITED', { headers: { 'retry-after': '5' } }));
    const getToken = vi.fn(() => Promise.resolve('jwt'));
    await expect(
      readEventStream({ path: '/s', baseUrl: 'x', getToken, fetchImpl, onMessage: vi.fn() }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 5 });
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true });
  });
});
