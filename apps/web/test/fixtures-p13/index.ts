/**
 * P13 API responses captured from the seeded demo user on 2026-11-25 (Europe/London, PRO plan)
 * with `apps/api/test/utils/capture-fixtures.ts`: GitHub + GitLab (two projects, MRs, a manual
 * commit email) + Jira (issues, detected story points field) + Linear (needs reconnection), the
 * provider list, issue feed / detail, KPIs with the Issues section, per-provider breakdown and the
 * career timeline with completed issues. Refresh: `npm run db:seed`, build the API, then run the
 * capture script (README → Web app → View tests).
 */
import career from './career.json';
import definitions from './definitions.json';
import feedGitlab from './feed-gitlab.json';
import feedIssues from './feed-issues.json';
import identitiesGitlab from './identities-gitlab.json';
import integrations from './integrations.json';
import issueDetail from './issue-detail.json';
import kpis from './kpis.json';
import me from './me.json';
import providersBreakdown from './providers-breakdown.json';
import providers from './providers.json';
import reposGitlab from './repos-gitlab.json';
import syncRunsJira from './sync-runs-jira.json';
import syncStatusGitlab from './sync-status-gitlab.json';
import syncStatusJira from './sync-status-jira.json';
import syncStatusLinear from './sync-status-linear.json';

import type { ProviderAvailability } from '../../src/lib/api/provider-hooks';
import type {
  CareerTimelineResponse,
  DefinitionsResponse,
  FeedItem,
  IdentityDto,
  IntegrationDto,
  IssueDetail,
  KpisResponse,
  MeDto,
  PageMeta,
  ProviderBreakdownResponse,
  RepositoryDto,
  SyncRunDto,
  SyncStatusDto,
} from '@devimpact/shared';

export const NOW = new Date('2026-11-25T12:00:00Z');

interface One<T> {
  data: T;
}
interface Page<T> {
  data: T[];
  meta: PageMeta;
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON fixture cast
const as = <T>(value: unknown) => value as T;

export const fx13 = {
  me: as<One<MeDto>>(me),
  integrations: as<One<IntegrationDto[]>>(integrations),
  providers: as<One<ProviderAvailability[]>>(providers),
  identitiesGitlab: as<One<IdentityDto[]>>(identitiesGitlab),
  syncRunsJira: as<Page<SyncRunDto>>(syncRunsJira),
  syncStatusJira: as<One<SyncStatusDto>>(syncStatusJira),
  syncStatusGitlab: as<One<SyncStatusDto>>(syncStatusGitlab),
  syncStatusLinear: as<One<SyncStatusDto>>(syncStatusLinear),
  reposGitlab: as<Page<RepositoryDto> & { meta: PageMeta & { total: number } }>(reposGitlab),
  feedIssues: as<Page<FeedItem>>(feedIssues),
  feedGitlab: as<Page<FeedItem>>(feedGitlab),
  issueDetail: as<One<IssueDetail>>(issueDetail),
  kpis: as<One<KpisResponse>>(kpis),
  providersBreakdown: as<One<ProviderBreakdownResponse>>(providersBreakdown),
  career: as<One<CareerTimelineResponse>>(career),
  definitions: as<One<DefinitionsResponse>>(definitions),
};

export const byProvider = (provider: IntegrationDto['provider']) => {
  const row = fx13.integrations.data.find((i) => i.provider === provider);
  if (!row) throw new Error(`fixture has no ${provider} integration`);
  return row;
};

export const clone = <T>(value: T): T => structuredClone(value);
