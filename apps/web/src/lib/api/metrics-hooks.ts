'use client';

import {
  type ProviderWire,
  AchievementStatementResponse,
  CareerTimelineResponse,
  CommitDetail,
  DefinitionsResponse,
  DocumentDetail,
  DocumentSummary,
  EvidenceItem,
  FeedItem,
  HeatmapResponse,
  HighlightsResponse,
  ImpactDto,
  ImpactHistoryResponse,
  KpisResponse,
  OverviewResponse,
  PullRequestDetail,
  TimeseriesResponse,
  TrendsResponse,
  type ActivityType,
  type TimeseriesInterval,
} from '@devimpact/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from './browser';
import { qk } from './query-keys';

/**
 * Metrics / impact / career queries (API_CONTRACT_V2 §9–§12). `period` is the explicit `?period=`
 * spec or undefined (API default). Previous data stays visible while the period changes
 * (`placeholderData`, DESIGN_SYSTEM §9 Loading).
 */
export function useOverview(period: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.metrics.overview(period),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/overview', { schema: OverviewResponse, query: { period }, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useKpis(period: string | undefined) {
  return useQuery({
    queryKey: qk.metrics.kpis(period),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/kpis', { schema: KpisResponse, query: { period }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useDefinitions() {
  return useQuery({
    queryKey: qk.metrics.definitions(),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/definitions', { schema: DefinitionsResponse, signal }),
    staleTime: 60 * 60 * 1000,
  });
}

export function useHeatmap(from?: string, to?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.metrics.heatmap(from, to),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/heatmap', { schema: HeatmapResponse, query: { from, to }, signal }),
    enabled: options.enabled ?? true,
  });
}

export function useImpact(period: string | undefined) {
  return useQuery({
    queryKey: qk.impact.detail(period),
    queryFn: ({ signal }) =>
      apiClient.get('/impact', { schema: ImpactDto, query: { period }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCareerTimeline(year?: number) {
  return useQuery({
    queryKey: qk.career.timeline(year),
    queryFn: ({ signal }) =>
      apiClient.get('/career/timeline', {
        schema: CareerTimelineResponse,
        query: { year },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useTimeseries(
  metric: string | null,
  interval: TimeseriesInterval,
  period: string | undefined,
) {
  return useQuery({
    queryKey: qk.metrics.timeseries(metric ?? 'none', interval, period),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/timeseries', {
        schema: TimeseriesResponse,
        query: { metric: metric ?? undefined, interval, period },
        signal,
      }),
    enabled: metric !== null,
  });
}

/** A-1: one call for every sparkline on the KPI page (never one timeseries per metric). */
export function useTrends(period: string | undefined, count = 6) {
  return useQuery({
    queryKey: qk.metrics.trends(period, count),
    queryFn: ({ signal }) =>
      apiClient.get('/metrics/trends', {
        schema: TrendsResponse,
        query: { period, count },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** A-2: a metric's evidence records, newest first (explain drawer: first page only). */
export function useMetricEvidence(metric: string | null, period: string | undefined, limit = 8) {
  return useQuery({
    queryKey: qk.metrics.evidence(metric ?? 'none', period, limit),
    queryFn: ({ signal }) =>
      apiClient.getPage('/metrics/evidence', {
        schema: EvidenceItem,
        query: { metric: metric ?? undefined, period, limit },
        signal,
      }),
    enabled: metric !== null,
  });
}

/** A-2 paged (Activity filtered by `?metric=`). */
export function useMetricEvidenceInfinite(metric: string | null, period: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...qk.metrics.evidence(metric ?? 'none', period, 40), 'pages'],
    queryFn: ({ signal, pageParam }) =>
      apiClient.getPage('/metrics/evidence', {
        schema: EvidenceItem,
        query: { metric: metric ?? undefined, period, limit: 40, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasMore ? (last.meta.nextCursor ?? undefined) : undefined,
    enabled: metric !== null,
  });
}

export function useImpactHistory(periodType: 'month' | 'quarter' = 'month', count = 12) {
  return useQuery({
    queryKey: qk.impact.history(periodType, count),
    queryFn: ({ signal }) =>
      apiClient.get('/impact/history', {
        schema: ImpactHistoryResponse,
        query: { periodType, count },
        signal,
      }),
  });
}

/**
 * `POST /impact/highlights` — explicit, cached per period on the server (fast model). The impact
 * query is refreshed afterwards so `GET /impact.highlights` points at the new document.
 */
export function useGenerateHighlights() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { period: string; regenerate?: boolean }) =>
      apiClient.post('/impact/highlights', { body: input, schema: HighlightsResponse }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.impact.all }),
  });
}

export interface FeedParams {
  period?: string;
  types?: ActivityType[];
  repoIds?: string[];
  /** P13: restrict to these providers (`github`, `gitlab`, `jira`, `linear`). */
  providers?: ProviderWire[];
  q?: string;
  limit?: number;
  [key: string]: string | number | string[] | undefined;
}

/** `GET /activity/feed` with cursor pages (infinite scroll, S6/S7). */
export function useActivityFeed(params: FeedParams, options: { enabled?: boolean } = {}) {
  const keyParams = {
    period: params.period,
    types: params.types?.join(','),
    repoIds: params.repoIds?.join(','),
    providers: params.providers?.join(','),
    q: params.q,
    limit: params.limit ?? 30,
  };
  return useInfiniteQuery({
    queryKey: qk.activity.feed(keyParams),
    queryFn: ({ signal, pageParam }) =>
      apiClient.getPage('/activity/feed', {
        schema: FeedItem,
        query: {
          period: params.period,
          types: params.types,
          repoIds: params.repoIds,
          providers: params.providers,
          q: params.q,
          limit: params.limit ?? 30,
          cursor: pageParam,
        },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.meta.hasMore ? (last.meta.nextCursor ?? undefined) : undefined,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function usePullRequest(id: string | null) {
  return useQuery({
    queryKey: qk.activity.pr(id ?? 'none'),
    queryFn: ({ signal }) =>
      apiClient.get(`/activity/prs/${encodeURIComponent(id ?? '')}`, {
        schema: PullRequestDetail,
        signal,
      }),
    enabled: id !== null,
  });
}

export function useCommit(id: string | null) {
  return useQuery({
    queryKey: qk.activity.commit(id ?? 'none'),
    queryFn: ({ signal }) =>
      apiClient.get(`/activity/commits/${encodeURIComponent(id ?? '')}`, {
        schema: CommitDetail,
        signal,
      }),
    enabled: id !== null,
  });
}

/** `POST /ai/achievement-statement` (F-51, quick quota). Saving achievements arrives in P12. */
export function useAchievementStatement() {
  return useMutation({
    mutationFn: (source: { kind: 'pull_request' | 'commit'; id: string }) =>
      apiClient.post('/ai/achievement-statement', {
        body: { source },
        schema: AchievementStatementResponse,
      }),
  });
}

/** Newest documents of a type (Next step rules: appraisal for the half, resume age). */
export function useRecentDocuments(type: 'appraisal' | 'resume', limit = 5) {
  return useQuery({
    queryKey: qk.documents.list({ type, limit }),
    queryFn: ({ signal }) =>
      apiClient.getPage('/documents', {
        schema: DocumentSummary,
        query: { type, limit, sort: '-createdAt' },
        signal,
      }),
    staleTime: 60_000,
  });
}

/** `GET /documents/:id` — e.g. the cached impact highlights document (`ImpactDto.highlights`). */
export function useDocument(id: string | null) {
  return useQuery({
    queryKey: qk.documents.detail(id ?? 'none'),
    queryFn: ({ signal }) =>
      apiClient.get(`/documents/${encodeURIComponent(id ?? '')}`, {
        schema: DocumentDetail,
        signal,
      }),
    enabled: id !== null,
  });
}
