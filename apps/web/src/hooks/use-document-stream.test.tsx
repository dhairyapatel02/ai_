import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import type { ReadStreamOptions, SseMessage } from '@/lib/api/event-stream';

import { useDocumentStream } from './use-document-stream';

import type { ReactNode } from 'react';

const ID = 'cmabcdefghijklmnopqrstuvw';
const msg = (id: string, event: string, data: unknown): SseMessage => ({
  id,
  event,
  data: JSON.stringify(data),
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { Wrapper, invalidate };
}

describe('useDocumentStream', () => {
  it('builds partial content from status → delta → section → done and refetches on done', async () => {
    let emit: ((m: SseMessage) => void) | null = null;
    let finish: (() => void) | null = null;
    const readStream = vi.fn(
      (o: ReadStreamOptions) =>
        new Promise<void>((resolve) => {
          emit = o.onMessage;
          finish = resolve;
        }),
    );
    const onTerminal = vi.fn();
    const { Wrapper, invalidate } = wrapper();
    const { result } = renderHook(
      () => useDocumentStream(ID, { status: 'pending', type: 'appraisal', readStream, onTerminal }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(emit).not.toBeNull();
    });
    act(() => {
      emit?.(msg('1-0', 'status', { status: 'pending', version: 1 }));
    });
    expect(result.current.phase).toBe('queued');
    act(() => {
      emit?.(msg('2-0', 'status', { status: 'streaming', version: 1 }));
      emit?.(msg('3-0', 'delta', { key: 'executiveSummary', text: 'In H2 I ' }));
      emit?.(msg('4-0', 'delta', { key: 'executiveSummary', text: 'focused on' }));
    });
    expect(result.current.draft).toBe('In H2 I focused on');
    expect(result.current.step).toEqual({ index: 1, total: 5, label: 'Executive summary' });
    act(() => {
      emit?.(
        msg('5-0', 'section', {
          key: 'executiveSummary',
          index: 0,
          content: { text: 'In H2 I focused on reliability.', citations: ['PR-acme/api#1'] },
        }),
      );
      emit?.(
        msg('6-0', 'section', {
          key: 'keyContributions',
          index: 1,
          content: { title: 'B', text: 'Second', citations: [] },
        }),
      );
    });
    expect(result.current.draft).toBe('');
    expect(result.current.step?.label).toBe('Key contributions');
    expect(result.current.content).toEqual({
      sections: {
        executiveSummary: { text: 'In H2 I focused on reliability.', citations: ['PR-acme/api#1'] },
        keyContributions: [undefined, { title: 'B', text: 'Second', citations: [] }],
      },
    });
    act(() => {
      emit?.(
        msg('7-0', 'done', {
          documentId: ID,
          version: 1,
          citationCoverage: 0.96,
          flags: { uncited: 1, invalid: 0 },
        }),
      );
      finish?.();
    });
    await waitFor(() => {
      expect(result.current.phase).toBe('done');
    });
    expect(result.current.done).toEqual({ citationCoverage: 0.96, uncited: 1 });
    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ event: 'done' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['documents', 'detail', ID] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['usage'] });
  });

  it('keeps resume sections at the top level and treats summary as a single claim', async () => {
    const readStream = vi.fn((o: ReadStreamOptions) => {
      o.onMessage(msg('1-0', 'status', { status: 'streaming', version: 1 }));
      o.onMessage(
        msg('2-0', 'section', { key: 'summary', index: 0, content: { text: 'S', citations: [] } }),
      );
      o.onMessage(
        msg('3-0', 'section', {
          key: 'bullets',
          index: 0,
          content: { text: 'B1', theme: 'Delivery', citations: [] },
        }),
      );
      return new Promise<void>(() => undefined);
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useDocumentStream(ID, { status: 'streaming', type: 'resume', readStream }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.content).toEqual({
        summary: { text: 'S', citations: [] },
        bullets: [{ text: 'B1', theme: 'Delivery', citations: [] }],
      });
    });
    expect(result.current.step).toEqual({ index: 2, total: 2, label: 'Resume bullets' });
  });

  it('ends with the error event (nothing counted) and with cancelled', async () => {
    const failing = vi.fn((o: ReadStreamOptions) => {
      o.onMessage(msg('1-0', 'status', { status: 'streaming', version: 1 }));
      o.onMessage(
        msg('2-0', 'error', { code: 'UPSTREAM_UNAVAILABLE', message: 'busy', retryable: true }),
      );
      return Promise.resolve();
    });
    const { Wrapper } = wrapper();
    const failed = renderHook(
      () => useDocumentStream(ID, { status: 'streaming', type: 'promotion', readStream: failing }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(failed.result.current.phase).toBe('error');
    });
    expect(failed.result.current.error).toEqual({
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'busy',
      retryable: true,
    });

    const cancelling = vi.fn((o: ReadStreamOptions) => {
      o.onMessage(msg('9-0', 'cancelled', { documentId: ID }));
      return Promise.resolve();
    });
    const stopped = renderHook(
      () => useDocumentStream(ID, { status: 'pending', type: 'promotion', readStream: cancelling }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(stopped.result.current.phase).toBe('cancelled');
    });
  });

  it('resumes with Last-Event-ID after a drop, and falls back to polling when the stream fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: (string | null | undefined)[] = [];
    const readStream = vi
      .fn<(o: ReadStreamOptions) => Promise<void>>()
      .mockImplementationOnce((o) => {
        seen.push(o.lastEventId);
        o.onMessage(
          msg('5-0', 'section', {
            key: 'whyReady',
            index: 0,
            content: { text: 'W', citations: [] },
          }),
        );
        return Promise.resolve(); // dropped
      })
      .mockImplementationOnce((o) => {
        seen.push(o.lastEventId);
        o.onMessage(msg('6-0', 'cancelled', { documentId: ID }));
        return Promise.resolve();
      });
    const { Wrapper } = wrapper();
    const resumed = renderHook(
      () => useDocumentStream(ID, { status: 'streaming', type: 'promotion', readStream }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await waitFor(() => {
      expect(resumed.result.current.phase).toBe('cancelled');
    });
    expect(seen).toEqual([null, '5-0']);

    const broken = vi.fn(() =>
      Promise.reject(new ApiError({ code: 'NOT_FOUND', message: 'gone', status: 404 })),
    );
    const failed = renderHook(
      () => useDocumentStream(ID, { status: 'streaming', type: 'promotion', readStream: broken }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(failed.result.current.fallback).toBe(true);
    });
    vi.useRealTimers();
  });

  it('stays idle for finished documents', () => {
    const readStream = vi.fn(() => Promise.resolve());
    const { Wrapper } = wrapper();
    const { result } = renderHook(
      () => useDocumentStream(ID, { status: 'ready', type: 'appraisal', readStream }),
      { wrapper: Wrapper },
    );
    expect(result.current.phase).toBe('idle');
    expect(readStream).not.toHaveBeenCalled();
  });
});
