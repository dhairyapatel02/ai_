'use client';

import {
  CreateDocumentResponse,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionListItem,
  PreviewEvidenceResponse,
  UsageResponse,
  exportFilename,
  type CreateDocumentInput,
  type DocumentOptions,
  type ExportFormatWire,
  type StudioDocumentType,
} from '@devimpact/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { apiClient } from './browser';
import { qk } from './query-keys';

/**
 * Documents & generation hooks (API_CONTRACT_V2 §13, S11–S16). Mutations write the returned
 * `DocumentDetail` into the cache and invalidate the lists, versions and usage they affect.
 */

export type LibrarySort = '-updatedAt' | '-createdAt' | 'title';
export interface LibraryParams {
  type?: StudioDocumentType;
  q?: string;
  sort?: LibrarySort;
}

const PAGE = 20;

/** `GET /documents` with cursor pages (library, S11). */
export function useDocumentLibrary(params: LibraryParams) {
  const key = { type: params.type, q: params.q || undefined, sort: params.sort ?? '-updatedAt' };
  return useInfiniteQuery({
    queryKey: qk.documents.library(key),
    queryFn: ({ signal, pageParam }) =>
      apiClient.getPage('/documents', {
        schema: DocumentSummary,
        query: { ...key, limit: PAGE, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasMore ? (last.meta.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
  });
}

export const isGenerating = (status: string | undefined) =>
  status === 'pending' || status === 'streaming';

/**
 * Documents still generating (`GET /documents?status=pending,streaming`): the Documents nav
 * spinner (IA §3.1, GAP-13) and "ready" toasts. Polls every 4 s only while one is running.
 */
export function useActiveDocuments(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.documents.active(),
    queryFn: ({ signal }) =>
      apiClient.getPage('/documents', {
        schema: DocumentSummary,
        query: { status: 'pending,streaming', limit: 5, sort: '-createdAt' },
        signal,
      }),
    refetchInterval: (query) => ((query.state.data?.items.length ?? 0) > 0 ? 4000 : false),
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  });
}

/** `GET /documents/:id?version=`; `poll` refetches every 2 s (SSE fallback). */
export function useDocumentDetail(
  id: string | null,
  options: { version?: number; poll?: boolean } = {},
) {
  return useQuery({
    queryKey: qk.documents.detail(id ?? 'none', options.version),
    queryFn: ({ signal }) =>
      apiClient.get(`/documents/${encodeURIComponent(id ?? '')}`, {
        schema: DocumentDetail,
        query: { version: options.version },
        signal,
      }),
    enabled: id !== null,
    refetchInterval: (query) =>
      options.poll && isGenerating(query.state.data?.document.status) ? 2000 : false,
  });
}

export function useDocumentVersions(id: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.documents.versions(id ?? 'none'),
    queryFn: ({ signal }) =>
      apiClient.getPage(`/documents/${encodeURIComponent(id ?? '')}/versions`, {
        schema: DocumentVersionListItem,
        query: { limit: 50 },
        signal,
      }),
    enabled: id !== null && (options.enabled ?? true),
  });
}

/** `GET /me/usage` — generations used / limit / reset date (QuotaMeter, studio footer). */
export function useUsage(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.usage.month(),
    queryFn: ({ signal }) => apiClient.get('/me/usage', { schema: UsageResponse, signal }),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

/** Value that settles `ms` after the last change (studio options → evidence preview). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

/** `POST /documents/preview-evidence` (no AI, no quota) for the studio aside. */
export function usePreviewEvidence(options: DocumentOptions | null) {
  return useQuery({
    queryKey: qk.documents.preview((options ?? {}) as Record<string, unknown>),
    queryFn: ({ signal }) =>
      apiClient.post('/documents/preview-evidence', {
        body: options,
        schema: PreviewEvidenceResponse,
        signal,
      }),
    enabled: options !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

function refreshLists(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['documents', 'library'] });
  void queryClient.invalidateQueries({ queryKey: ['documents', 'list'] });
  void queryClient.invalidateQueries({ queryKey: qk.documents.active() });
}

function storeDetail(queryClient: QueryClient, detail: DocumentDetail) {
  const id = detail.document.id;
  // Other cached versions keep their content; the "current" entry is replaced.
  queryClient.setQueryData(qk.documents.detail(id), detail);
  void queryClient.invalidateQueries({ queryKey: qk.documents.versions(id) });
  refreshLists(queryClient);
}

/** `POST /documents` → 201 pending (+ stream) or 200 cached (existing document). */
export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDocumentInput) =>
      apiClient.post('/documents', { body, schema: CreateDocumentResponse }),
    onSuccess: () => {
      refreshLists(queryClient);
      void queryClient.invalidateQueries({ queryKey: qk.usage.all });
    },
  });
}

export interface UpdateDocumentVars {
  baseVersion: number;
  title?: string;
  content?: unknown;
}

/** `PATCH /documents/:id` (autosave → new `user_edit` version, rename). */
export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDocumentVars) =>
      apiClient.patch(`/documents/${encodeURIComponent(id)}`, { body, schema: DocumentDetail }),
    onSuccess: (detail) => {
      storeDetail(queryClient, detail);
    },
  });
}

/** `POST /documents/:id/versions/:n/restore` → new `restore` version. */
export function useRestoreVersion(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      apiClient.post(`/documents/${encodeURIComponent(id)}/versions/${version}/restore`, {
        schema: DocumentDetail,
      }),
    onSuccess: (detail) => {
      storeDetail(queryClient, detail);
    },
  });
}

const RegenerateResponse = z.object({ document: DocumentSummary, streamUrl: z.string() });

export interface RegenerateVars {
  section?: string;
  options?: Record<string, unknown>;
}

/** `POST /documents/:id/regenerate` — whole document, changed options, or one section. */
export function useRegenerateDocument(id: string) {
  const regenerate = useRegenerateAny();
  return {
    ...regenerate,
    mutate: (body: RegenerateVars, options?: Parameters<typeof regenerate.mutate>[1]) => {
      regenerate.mutate({ id, body }, options);
    },
  };
}

/** Regenerate any document by id (library "Retry"). */
export function useRegenerateAny() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RegenerateVars }) =>
      apiClient.post(`/documents/${encodeURIComponent(id)}/regenerate`, {
        body,
        schema: RegenerateResponse,
      }),
    onSuccess: (res) => {
      const id = res.document.id;
      queryClient.setQueryData<DocumentDetail>(qk.documents.detail(id), (old) =>
        old ? { ...old, document: { ...old.document, ...res.document } } : old,
      );
      void queryClient.invalidateQueries({ queryKey: qk.documents.one(id) });
      void queryClient.invalidateQueries({ queryKey: qk.usage.all });
      refreshLists(queryClient);
    },
  });
}

/** `POST /documents/:id/cancel` (no quota consumed). */
export function useCancelDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post(`/documents/${encodeURIComponent(id)}/cancel`, {
        schema: z.object({ document: DocumentSummary }),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.documents.one(id) });
      void queryClient.invalidateQueries({ queryKey: qk.usage.all });
      refreshLists(queryClient);
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/documents/${encodeURIComponent(id)}`, {
        schema: z.object({ deleted: z.literal(true) }),
      }),
    onSuccess: (_res, id) => {
      queryClient.removeQueries({ queryKey: qk.documents.one(id) });
      refreshLists(queryClient);
    },
  });
}

export interface ExportVars {
  id: string;
  format: ExportFormatWire;
  version?: number;
  citations?: boolean;
  /** Used when the server's filename is unreadable (fallback only). */
  fallback: { type: DocumentSummary['type']; period: string | null | undefined; version: number };
}

/** Saves a Blob under `filename` (a temporary object URL on a hidden link). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}

/** `GET /documents/:id/export?format=` → download (ADR-0012). Resolves with the filename. */
export function useExportDocument() {
  return useMutation({
    mutationFn: async (vars: ExportVars) => {
      const { blob, filename } = await apiClient.download(
        `/documents/${encodeURIComponent(vars.id)}/export`,
        {
          query: {
            format: vars.format,
            version: vars.version,
            citations: vars.citations === undefined ? undefined : String(vars.citations),
          },
        },
      );
      const name =
        filename ??
        exportFilename(
          vars.fallback.type,
          vars.fallback.period,
          vars.fallback.version,
          vars.format,
        );
      saveBlob(blob, name);
      return name;
    },
  });
}
