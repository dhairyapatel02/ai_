'use client';

import {
  SECTION_SPECS,
  writtenSections,
  type DocumentStreamEvent,
  type DocumentTypeWire,
} from '@devimpact/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { isGenerating } from '@/lib/api/document-hooks';
import { parseDocumentEvent } from '@/lib/api/event-stream';
import { qk } from '@/lib/api/query-keys';

import { useEventStream, type UseEventStreamOptions } from './use-event-stream';

/**
 * Live view of a generation (S16 streaming, FLOWS F5): consumes `GET /documents/:id/stream`
 * (fetch-based SSE, `Last-Event-ID` resume, 5 reconnects) and builds the partial content from
 * `section` events, with the text of the section being written from `delta` events. On `done`
 * the saved document is refetched; on `error`/`cancelled` the terminal state is kept. When the
 * stream gives up (`status: 'error'`) callers poll `GET /documents/:id` instead (`fallback`).
 * Reopening a generating document replays the stream from its start (kept 1 h, UX-12).
 */

export type StreamPhase = 'idle' | 'queued' | 'writing' | 'done' | 'error' | 'cancelled';

export interface StreamTerminalError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface DocumentStreamState {
  phase: StreamPhase;
  version: number | null;
  /** Partial content in the stored shape (`sections.<key>` for appraisal/promotion). */
  content: Record<string, unknown> | null;
  /** Key of the section being written and its streamed text so far. */
  currentKey: string | null;
  draft: string;
  /** "Writing section 2 of 5 · Key contributions" parts. */
  step: { index: number; total: number; label: string } | null;
  error: StreamTerminalError | null;
  done: { citationCoverage: number | null; uncited: number } | null;
}

const INITIAL: DocumentStreamState = {
  phase: 'idle',
  version: null,
  content: null,
  currentKey: null,
  draft: '',
  step: null,
  error: null,
  done: null,
};

type Action =
  { type: 'event'; event: DocumentStreamEvent; docType: DocumentTypeWire } | { type: 'reset' };

const nested = (t: DocumentTypeWire) => t === 'appraisal' || t === 'promotion';

function shapeOf(docType: DocumentTypeWire, key: string) {
  const specs =
    docType in SECTION_SPECS ? SECTION_SPECS[docType as keyof typeof SECTION_SPECS] : [];
  return specs.find((s) => s.key === key)?.shape ?? 'claims';
}

function stepFor(docType: DocumentTypeWire, key: string | null) {
  if (!key) return null;
  const written = writtenSections(docType);
  const index = written.findIndex((s) => s.key === key);
  if (index < 0) return null;
  return { index: index + 1, total: written.length, label: written[index]?.label ?? key };
}

function putSection(
  docType: DocumentTypeWire,
  content: Record<string, unknown> | null,
  key: string,
  index: number,
  value: unknown,
): Record<string, unknown> {
  const root: Record<string, unknown> = { ...(content ?? {}) };
  const body: Record<string, unknown> = nested(docType)
    ? { ...((root.sections as Record<string, unknown> | undefined) ?? {}) }
    : root;
  if (shapeOf(docType, key) === 'claim') body[key] = value;
  else {
    const list = Array.isArray(body[key]) ? [...(body[key] as unknown[])] : [];
    list[index] = value;
    body[key] = list;
  }
  if (nested(docType)) root.sections = body;
  return root;
}

function reducer(state: DocumentStreamState, action: Action): DocumentStreamState {
  if (action.type === 'reset') return INITIAL;
  const { event, docType } = action;
  switch (event.event) {
    case 'status': {
      const fresh = state.version !== event.data.version;
      const base = fresh ? { ...INITIAL, version: event.data.version } : state;
      return { ...base, phase: event.data.status === 'pending' ? 'queued' : 'writing' };
    }
    case 'delta': {
      const same = state.currentKey === event.data.key;
      return {
        ...state,
        phase: 'writing',
        currentKey: event.data.key,
        draft: (same ? state.draft : '') + event.data.text,
        step: stepFor(docType, event.data.key) ?? state.step,
      };
    }
    case 'section':
      return {
        ...state,
        phase: 'writing',
        content: putSection(
          docType,
          state.content,
          event.data.key,
          event.data.index,
          event.data.content,
        ),
        currentKey: event.data.key,
        draft: '',
        step: stepFor(docType, event.data.key) ?? state.step,
      };
    case 'done':
      return {
        ...state,
        phase: 'done',
        currentKey: null,
        draft: '',
        done: { citationCoverage: event.data.citationCoverage, uncited: event.data.flags.uncited },
      };
    case 'error':
      return { ...state, phase: 'error', currentKey: null, draft: '', error: event.data };
    case 'cancelled':
      return { ...state, phase: 'cancelled', currentKey: null, draft: '' };
  }
}

export interface UseDocumentStreamOptions {
  /** Document status from `GET /documents/:id`; the stream opens while pending/streaming. */
  status: string | undefined;
  type: DocumentTypeWire | undefined;
  onTerminal?: (event: DocumentStreamEvent) => void;
  /** Test seam for the SSE reader. */
  readStream?: UseEventStreamOptions<DocumentStreamEvent>['readStream'];
}

export function useDocumentStream(id: string | null, options: UseDocumentStreamOptions) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const typeRef = useRef(options.type);
  typeRef.current = options.type;
  const onTerminalRef = useRef(options.onTerminal);
  onTerminalRef.current = options.onTerminal;

  const active = id !== null && options.type !== undefined && isGenerating(options.status);
  const refresh = useCallback(() => {
    if (!id) return;
    void queryClient.invalidateQueries({ queryKey: qk.documents.one(id) });
    void queryClient.invalidateQueries({ queryKey: qk.documents.versions(id) });
    void queryClient.invalidateQueries({ queryKey: ['documents', 'library'] });
    void queryClient.invalidateQueries({ queryKey: ['documents', 'list'] });
    void queryClient.invalidateQueries({ queryKey: qk.documents.active() });
    void queryClient.invalidateQueries({ queryKey: qk.usage.all });
  }, [id, queryClient]);

  // A generation that finished while this page wasn't streaming (e.g. server-rendered as ready)
  // still has to leave the Documents nav spinner.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      void queryClient.invalidateQueries({ queryKey: qk.documents.active() });
    }
    wasActive.current = active;
  }, [active, queryClient]);

  const stream = useEventStream<DocumentStreamEvent>(id ? `/documents/${id}/stream` : null, {
    enabled: active,
    parse: parseDocumentEvent,
    readStream: options.readStream,
    onEvent: (event) => {
      if (!typeRef.current) return;
      dispatch({ type: 'event', event, docType: typeRef.current });
      if (event.event === 'done' || event.event === 'error' || event.event === 'cancelled') {
        refresh();
        onTerminalRef.current?.(event);
      }
    },
  });

  return {
    ...state,
    /** The SSE connection failed for good: poll `GET /documents/:id` until it finishes. */
    fallback: active && stream.status === 'error',
    connection: stream.status,
    reset: () => {
      dispatch({ type: 'reset' });
    },
  };
}
