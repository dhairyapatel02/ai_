/**
 * P11 API responses captured from the seeded demo user on 2026-11-21 (Europe/London): the library
 * (3 seeded v2 documents + 3 v0.1 imports), the appraisal (3 versions, one uncited claim), the
 * curated resume (pinned + used bullets), the promotion packet, a legacy import, usage, `/me` and
 * an appraisal evidence preview. Refresh: run `npm run db:seed`, sign in, `curl` the endpoints.
 */
import appraisalV1 from './appraisal-v1.json';
import appraisal from './appraisal.json';
import documents from './documents.json';
import legacy from './legacy.json';
import me from './me.json';
import preview from './preview.json';
import promotion from './promotion.json';
import resume from './resume.json';
import usage from './usage.json';
import versions from './versions.json';

import type {
  DocumentDetail,
  DocumentSummary,
  DocumentVersionListItem,
  MeDto,
  PageMeta,
  PreviewEvidenceResponse,
  UsageResponse,
} from '@devimpact/shared';
import type { z } from 'zod';

export const NOW = new Date('2026-11-21T12:00:00Z');

interface One<T> {
  data: T;
}
interface Page<T> {
  data: T[];
  meta: PageMeta;
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON fixture cast
const as = <T>(value: unknown) => value as T;

export const fx11 = {
  documents: as<Page<DocumentSummary>>(documents),
  appraisal: as<One<DocumentDetail>>(appraisal),
  appraisalV1: as<One<DocumentDetail>>(appraisalV1),
  resume: as<One<DocumentDetail>>(resume),
  promotion: as<One<DocumentDetail>>(promotion),
  legacy: as<One<DocumentDetail>>(legacy),
  versions: as<Page<z.infer<typeof DocumentVersionListItem>>>(versions),
  usage: as<One<UsageResponse>>(usage),
  me: as<One<MeDto>>(me),
  preview: as<One<PreviewEvidenceResponse>>(preview),
};

/** Deep copy for tests that mutate a fixture. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
