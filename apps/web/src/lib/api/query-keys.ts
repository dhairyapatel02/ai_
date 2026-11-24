/**
 * Query-key factory (ADR-0010). Conventions:
 * - The first element is the resource domain (`'me'`, `'metrics'`, `'sync'`…), so a whole domain is
 *   invalidated with its `all` key: `queryClient.invalidateQueries({ queryKey: qk.metrics.all })`.
 * - Period-scoped keys take the explicit `?period=` spec, or `'default'` when the URL has none (the
 *   API then uses the user's default period, IA §4) — never a value computed on the client.
 * - Parameter objects go last and contain only what is sent to the API.
 */
type Period = string | null | undefined;
const p = (period: Period) => period ?? 'default';

export const qk = {
  me: { all: ['me'] as const, detail: () => ['me', 'detail'] as const },
  integrations: {
    all: ['integrations'] as const,
    list: () => ['integrations', 'list'] as const,
    detail: (id: string) => ['integrations', 'detail', id] as const,
  },
  repos: {
    all: ['repos'] as const,
    list: (params: Record<string, string | number | boolean | undefined>) =>
      ['repos', 'list', params] as const,
  },
  sync: {
    all: ['sync'] as const,
    status: (integrationId?: string) => ['sync', 'status', integrationId ?? 'default'] as const,
    runs: (integrationId?: string) => ['sync', 'runs', integrationId ?? 'default'] as const,
  },
  metrics: {
    all: ['metrics'] as const,
    definitions: () => ['metrics', 'definitions'] as const,
    overview: (period: Period) => ['metrics', 'overview', p(period)] as const,
    kpis: (period: Period) => ['metrics', 'kpis', p(period)] as const,
    repos: (period: Period, limit: number) => ['metrics', 'repos', p(period), limit] as const,
    heatmap: (from?: string, to?: string) =>
      ['metrics', 'heatmap', from ?? 'default', to ?? 'default'] as const,
    timeseries: (metric: string, interval: string, period: Period) =>
      ['metrics', 'timeseries', metric, interval, p(period)] as const,
    trends: (period: Period, count: number) => ['metrics', 'trends', p(period), count] as const,
    evidence: (metric: string, period: Period, limit: number) =>
      ['metrics', 'evidence', metric, p(period), limit] as const,
  },
  impact: {
    all: ['impact'] as const,
    detail: (period: Period) => ['impact', 'detail', p(period)] as const,
    history: (periodType: 'month' | 'quarter', count: number) =>
      ['impact', 'history', periodType, count] as const,
  },
  career: {
    all: ['career'] as const,
    timeline: (year?: number) => ['career', 'timeline', year ?? 'default'] as const,
  },
  activity: {
    all: ['activity'] as const,
    feed: (params: Record<string, string | number | undefined>) =>
      ['activity', 'feed', params] as const,
    pr: (id: string) => ['activity', 'pr', id] as const,
    commit: (id: string) => ['activity', 'commit', id] as const,
  },
  documents: {
    all: ['documents'] as const,
    list: (params: Record<string, string | number | undefined>) =>
      ['documents', 'list', params] as const,
    detail: (id: string, version?: number) =>
      ['documents', 'detail', id, version ?? 'current'] as const,
    /** Every cached version of one document (invalidate after edits, restore, regenerate). */
    one: (id: string) => ['documents', 'detail', id] as const,
    versions: (id: string) => ['documents', 'versions', id] as const,
    /** Library pages (S11): type, search, sort. */
    library: (params: Record<string, string | undefined>) =>
      ['documents', 'library', params] as const,
    /** Documents still generating (Documents nav spinner, GAP-13). */
    active: () => ['documents', 'active'] as const,
    preview: (options: Record<string, unknown>) => ['documents', 'preview', options] as const,
  },
  usage: {
    all: ['usage'] as const,
    month: () => ['usage', 'month', 'current'] as const,
  },
} as const;

/** Domains whose data changes when a sync finishes (FLOWS F4: refresh in place, no reload). */
export const SYNC_DEPENDENT_KEYS = [
  qk.metrics.all,
  qk.impact.all,
  qk.career.all,
  qk.activity.all,
  qk.repos.all,
  qk.integrations.all,
  qk.me.all,
] as const;
