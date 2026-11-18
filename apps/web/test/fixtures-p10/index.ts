/** API responses captured from the seeded demo user on 2026-11-18 (Europe/London). */
import career from './career.json';
import definitions from './definitions.json';
import evidence from './evidence.json';
import feed from './feed.json';
import heatmap from './heatmap.json';
import impactHistory from './impact-history.json';
import impact from './impact.json';
import integrations from './integrations.json';
import kpis from './kpis.json';
import me from './me.json';
import overview from './overview.json';
import repos from './repos.json';
import syncRuns from './sync-runs.json';
import syncStatus from './sync-status.json';
import timeseries from './timeseries.json';
import trends from './trends.json';

import type {
  CareerTimelineResponse,
  DefinitionsResponse,
  EvidenceItem,
  FeedItem,
  HeatmapResponse,
  ImpactDto,
  ImpactHistoryResponse,
  IntegrationDto,
  KpisResponse,
  MeDto,
  OverviewResponse,
  PageMeta,
  RepositoryDto,
  SyncRunDto,
  SyncStatusDto,
  TimeseriesResponse,
  TrendsResponse,
} from '@devimpact/shared';

export const NOW = new Date('2026-11-18T12:00:00Z');

interface One<T> {
  data: T;
}
interface Page<T> {
  data: T[];
  meta: PageMeta;
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON fixture cast
const as = <T>(value: unknown) => value as T;

export const fx = {
  career: as<One<CareerTimelineResponse>>(career),
  definitions: as<One<DefinitionsResponse>>(definitions),
  evidence: as<Page<EvidenceItem>>(evidence),
  feed: as<Page<FeedItem>>(feed),
  heatmap: as<One<HeatmapResponse>>(heatmap),
  impactHistory: as<One<ImpactHistoryResponse>>(impactHistory),
  impact: as<One<ImpactDto>>(impact),
  integrations: as<One<IntegrationDto[]>>(integrations),
  kpis: as<One<KpisResponse>>(kpis),
  me: as<One<MeDto>>(me),
  overview: as<One<OverviewResponse>>(overview),
  repos: as<Page<RepositoryDto>>(repos),
  syncRuns: as<Page<SyncRunDto>>(syncRuns),
  syncStatus: as<One<SyncStatusDto>>(syncStatus),
  timeseries: as<One<TimeseriesResponse>>(timeseries),
  trends: as<One<TrendsResponse>>(trends),
};

/** Deep clone so a test can tweak a fixture without leaking into others. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
