import {
  DocumentStreamEvents,
  type DocumentStreamEvent,
  type DocumentStreamEventName,
} from '@devimpact/shared';

import { publicEnv } from '@/env';
import { getApiToken } from '@/lib/auth-client';

import { ApiError, isErrorCode } from './errors';

/** One server-sent event (WHATWG `text/event-stream`). Comments (`: heartbeat`) are dropped. */
export interface SseMessage {
  id: string | null;
  event: string;
  data: string;
}

/** Incremental `text/event-stream` parser: feed decoded chunks, get complete events. */
export class SseParser {
  private buffer = '';
  private id: string | null = null;
  private event = '';
  private data: string[] = [];

  feed(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, newline);
      const sepLength = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
      this.buffer = this.buffer.slice(newline + sepLength);
      if (line === '') {
        if (this.data.length) {
          out.push({ id: this.id, event: this.event || 'message', data: this.data.join('\n') });
        }
        this.event = '';
        this.data = [];
        continue;
      }
      if (line.startsWith(':')) continue; // comment, e.g. `: heartbeat`
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') this.data.push(value);
      else if (field === 'event') this.event = value;
      else if (field === 'id' && !value.includes('\0')) this.id = value;
      // `retry` and unknown fields are ignored: reconnect timing is ours.
    }
    return out;
  }
}

export interface ReadStreamOptions {
  /** API path, e.g. `/documents/:id/stream`. */
  path: string;
  lastEventId?: string | null;
  signal?: AbortSignal;
  onMessage: (message: SseMessage) => void;
  getToken?: (options: { forceRefresh: boolean }) => Promise<string | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Reads one SSE connection with `fetch` (EventSource can't send `Authorization`, ADR-0010).
 * Sends `Last-Event-ID` when resuming; refreshes the JWT once on 401. Resolves when the server
 * closes the stream; HTTP errors reject with a typed `ApiError`.
 */
export async function readEventStream(options: ReadStreamOptions): Promise<void> {
  const getToken = options.getToken ?? getApiToken;
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${options.baseUrl ?? publicEnv.NEXT_PUBLIC_API_URL}${options.path}`;

  const connect = async (forceRefresh: boolean) => {
    const token = await getToken({ forceRefresh });
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.lastEventId) headers['Last-Event-ID'] = options.lastEventId;
    return doFetch(url, {
      headers,
      signal: options.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  };

  let res = await connect(false);
  if (res.status === 401) res = await connect(true);
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: unknown; message?: string; requestId?: string };
    } | null;
    const code = isErrorCode(body?.error?.code) ? body.error.code : 'INTERNAL';
    throw new ApiError({
      code: res.ok ? 'INVALID_RESPONSE' : code,
      message: body?.error?.message ?? `Stream failed (${res.status})`,
      status: res.status,
      requestId: body?.error?.requestId ?? res.headers.get('x-request-id'),
      retryAfterSeconds: Number(res.headers.get('retry-after')) || null,
    });
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const message of parser.feed(value)) options.onMessage(message);
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Document generation events (API_CONTRACT_V2 §13.3) ──────────────────────────────────────

export const TERMINAL_EVENTS: ReadonlySet<string> = new Set(['done', 'error', 'cancelled']);

/**
 * Typed document event `{ event, data }` validated with the shared `DocumentStreamEvents` schemas,
 * or null for unknown events / malformed data (ignored by the hook).
 */
export function parseDocumentEvent(message: SseMessage): DocumentStreamEvent | null {
  if (!Object.hasOwn(DocumentStreamEvents, message.event)) return null;
  const name = message.event as DocumentStreamEventName;
  let raw: unknown;
  try {
    raw = JSON.parse(message.data);
  } catch {
    return null;
  }
  const parsed = DocumentStreamEvents[name].safeParse(raw);
  return parsed.success ? ({ event: name, data: parsed.data } as DocumentStreamEvent) : null;
}
