'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/errors';
import {
  readEventStream,
  TERMINAL_EVENTS,
  type ReadStreamOptions,
  type SseMessage,
} from '@/lib/api/event-stream';

export type EventStreamStatus =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface UseEventStreamOptions<E> {
  /** Defaults to true; pass false to keep the hook idle (e.g. until a document id exists). */
  enabled?: boolean;
  /** Maps a raw message to a typed event; return null to ignore it. */
  parse: (message: SseMessage) => E | null;
  onEvent?: (event: E, message: SseMessage) => void;
  /** Reconnect attempts after an unexpected drop (exponential backoff from 1 s). Default 5. */
  maxRetries?: number;
  /** Event names that end the stream (default `done` / `error` / `cancelled`). */
  terminalEvents?: ReadonlySet<string>;
  /** Test seam. */
  readStream?: (options: ReadStreamOptions) => Promise<void>;
}

export interface EventStreamState {
  status: EventStreamStatus;
  error: ApiError | null;
  lastEventId: string | null;
  /** Name of the terminal event received, if any. */
  terminal: string | null;
  close: () => void;
  reconnect: () => void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Fetch-based SSE hook (ADR-0010) for `GET /documents/:id/stream` (P11) and future streams.
 * Ignores `: heartbeat` comments, resumes with `Last-Event-ID` after a drop, stops on a terminal
 * event and gives up after `maxRetries` (callers then fall back to polling the resource).
 * HTTP errors (404, 429 `RATE_LIMITED { class: "sse" }`) end in `status: 'error'` with `error`.
 */
export function useEventStream<E>(path: string | null, options: UseEventStreamOptions<E>) {
  const { enabled = true, maxRetries = 5 } = options;
  const [status, setStatus] = useState<EventStreamStatus>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [terminal, setTerminal] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!path || !enabled) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const read = optionsRef.current.readStream ?? readEventStream;
    const terminals = optionsRef.current.terminalEvents ?? TERMINAL_EVENTS;

    void (async () => {
      let attempt = 0;
      let ended: string | null = null;
      setError(null);
      setTerminal(null);
      while (!controller.signal.aborted && !ended) {
        setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
        try {
          await read({
            path,
            lastEventId: lastIdRef.current,
            signal: controller.signal,
            onMessage: (message) => {
              setStatus('open');
              attempt = 0;
              if (message.id) {
                lastIdRef.current = message.id;
                setLastEventId(message.id);
              }
              const event = optionsRef.current.parse(message);
              if (event !== null) optionsRef.current.onEvent?.(event, message);
              if (terminals.has(message.event)) ended = message.event;
            },
          });
        } catch (caught) {
          if (controller.signal.aborted) return;
          if (caught instanceof ApiError && !caught.retryable) {
            setError(caught);
            setStatus('error');
            return;
          }
        }
        if (ended || controller.signal.aborted) break;
        attempt += 1;
        if (attempt > maxRetries) {
          setError(
            new ApiError({ code: 'NETWORK_ERROR', message: 'The stream disconnected', status: 0 }),
          );
          setStatus('error');
          return;
        }
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000), controller.signal);
      }
      if (ended) {
        setTerminal(ended);
        setStatus('closed');
      }
    })();

    return () => {
      controller.abort();
    };
  }, [path, enabled, maxRetries, generation]);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    setStatus('closed');
  }, []);
  const reconnect = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  return { status, error, lastEventId, terminal, close, reconnect } satisfies EventStreamState;
}
