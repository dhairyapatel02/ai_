import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import {
  parseDocumentEvent,
  type ReadStreamOptions,
  type SseMessage,
} from '@/lib/api/event-stream';

import { useEventStream } from './use-event-stream';

const msg = (id: string, event: string, data: unknown): SseMessage => ({
  id,
  event,
  data: JSON.stringify(data),
});

describe('useEventStream', () => {
  it('delivers typed events and closes on a terminal event', async () => {
    const readStream = vi.fn((o: ReadStreamOptions) => {
      o.onMessage(msg('1-0', 'status', { status: 'streaming', version: 1 }));
      o.onMessage(
        msg('2-0', 'done', {
          documentId: 'cmabcdefghijklmnopqrstuvw',
          version: 1,
          citationCoverage: 1,
          flags: { uncited: 0, invalid: 0 },
        }),
      );
      return Promise.resolve();
    });
    const onEvent = vi.fn();
    const { result } = renderHook(() =>
      useEventStream('/documents/cm1/stream', { parse: parseDocumentEvent, onEvent, readStream }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('closed');
    });
    expect(result.current.terminal).toBe('done');
    expect(result.current.lastEventId).toBe('2-0');
    expect(onEvent.mock.calls.map(([e]) => (e as { event: string }).event)).toEqual([
      'status',
      'done',
    ]);
    expect(readStream).toHaveBeenCalledTimes(1);
  });

  it('reconnects after a drop with the last event id as Last-Event-ID', async () => {
    const readStream = vi
      .fn<(o: ReadStreamOptions) => Promise<void>>(() => Promise.resolve())
      .mockImplementationOnce((o) => {
        o.onMessage(msg('5-0', 'section', { key: 'summary', index: 0, content: {} }));
        return Promise.resolve(); // dropped without a terminal event
      })
      .mockImplementationOnce((o) => {
        o.onMessage(msg('6-0', 'cancelled', { documentId: 'cmabcdefghijklmnopqrstuvw' }));
        return Promise.resolve();
      });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() =>
      useEventStream('/s', { parse: parseDocumentEvent, readStream }),
    );
    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => {
      expect(result.current.terminal).toBe('cancelled');
    });
    vi.useRealTimers();
    expect(readStream.mock.calls[1]?.[0].lastEventId).toBe('5-0');
  });

  it('stops with the ApiError on non-retryable HTTP errors', async () => {
    const readStream = vi.fn(() =>
      Promise.reject(
        new ApiError({ code: 'RATE_LIMITED', message: 'Too many streams', status: 429 }),
      ),
    );
    const { result } = renderHook(() =>
      useEventStream('/s', { parse: parseDocumentEvent, readStream }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error?.code).toBe('RATE_LIMITED');
    expect(readStream).toHaveBeenCalledTimes(1);
  });

  it('stays idle when disabled or without a path', () => {
    const readStream = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useEventStream(null, { parse: parseDocumentEvent, readStream }),
    );
    expect(result.current.status).toBe('idle');
    expect(readStream).not.toHaveBeenCalled();
  });
});
