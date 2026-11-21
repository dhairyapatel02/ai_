import { z } from 'zod';

import { Cursor, Id, PageQuery, Timestamp } from './common';
import { EvidenceItem, EvidenceRef, MetricValue, PeriodSpec, ResolvedPeriodDto } from './metrics';

/**
 * Documents, AI generation, AI utilities and usage contracts (API_CONTRACT_V2 §5 `/me/usage`,
 * §10 `POST /impact/highlights`, §13, §14 and amendments A-3/A-5). Content schemas are the
 * stored, validated document bodies; every claim-bearing item carries `citations` (evidence refs)
 * and optional `flags` set by the citation verifier (ADR-0009).
 */

// ── Enums (§3.2) ────────────────────────────────────────────────────────────────────────────

export const DOCUMENT_TYPES = [
  'resume',
  'appraisal',
  'promotion',
  'impact_narrative',
  'achievement_statement',
  'digest_summary',
] as const;
export const DocumentTypeWire = z.enum(DOCUMENT_TYPES);
export type DocumentTypeWire = z.infer<typeof DocumentTypeWire>;

/** Types created by `POST /documents` (the studios, S13–S15). */
export const STUDIO_DOCUMENT_TYPES = ['resume', 'appraisal', 'promotion'] as const;
export type StudioDocumentType = (typeof STUDIO_DOCUMENT_TYPES)[number];

export const DocumentStatusWire = z.enum(['pending', 'streaming', 'ready', 'failed', 'cancelled']);
export type DocumentStatusWire = z.infer<typeof DocumentStatusWire>;

export const VersionSourceWire = z.enum(['ai', 'user_edit', 'restore']);
export type VersionSourceWire = z.infer<typeof VersionSourceWire>;

export const AchievementCategoryWire = z.enum([
  'delivery',
  'quality',
  'mentoring',
  'incident',
  'leadership',
  'learning',
  'collaboration',
  'other',
]);
export type AchievementCategoryWire = z.infer<typeof AchievementCategoryWire>;

export const ResumeRole = z.enum(['backend', 'frontend', 'fullstack', 'devops', 'manager']);
export type ResumeRole = z.infer<typeof ResumeRole>;

// ── Options per type (§13.1) ────────────────────────────────────────────────────────────────

const roleText = z.string().trim().min(1).max(100);

export const ResumeOptions = z.strictObject({
  type: z.literal('resume'),
  period: PeriodSpec,
  role: ResumeRole,
  format: z.enum(['bullets', 'narrative']).default('bullets'),
  length: z.enum(['short', 'standard']).default('standard'),
  jobDescription: z.string().trim().max(8000).optional(),
});
export const AppraisalOptions = z.strictObject({
  type: z.literal('appraisal'),
  period: PeriodSpec,
  selfReflection: z.string().trim().max(4000).optional(),
});
/** `period` defaults to the last 12 months ending today (user time zone). */
export const PromotionOptions = z.strictObject({
  type: z.literal('promotion'),
  period: PeriodSpec.optional(),
  currentRole: roleText,
  targetRole: roleText,
  ladderText: z.string().trim().max(12000).optional(),
});

export const DocumentOptions = z.discriminatedUnion('type', [
  ResumeOptions,
  AppraisalOptions,
  PromotionOptions,
]);
export type DocumentOptions = z.infer<typeof DocumentOptions>;
export type ResumeOptions = z.infer<typeof ResumeOptions>;
export type AppraisalOptions = z.infer<typeof AppraisalOptions>;
export type PromotionOptions = z.infer<typeof PromotionOptions>;

const regenerate = { regenerate: z.boolean().optional() };
/** `POST /documents` body: the options plus `regenerate` (skip the inputHash cache). */
export const CreateDocumentInput = z.discriminatedUnion('type', [
  ResumeOptions.extend(regenerate),
  AppraisalOptions.extend(regenerate),
  PromotionOptions.extend(regenerate),
]);
export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>;

// ── Content (stored versions) ───────────────────────────────────────────────────────────────

export const CitationFlag = z.enum(['uncited', 'invalid_citation']);
export type CitationFlag = z.infer<typeof CitationFlag>;

const ItemId = z.string().min(1).max(40);

/** A claim-bearing item: prose that must cite evidence. */
export const ClaimItem = z.object({
  id: ItemId,
  text: z.string().min(1).max(2000),
  citations: z.array(EvidenceRef).max(20),
  flags: z.array(CitationFlag).optional(),
});
export type ClaimItem = z.infer<typeof ClaimItem>;

export const TitledClaim = ClaimItem.extend({ title: z.string().min(1).max(200) });
export type TitledClaim = z.infer<typeof TitledClaim>;

/** Forward-looking text (goals, focus areas): not a claim about past work, no citations. */
export const PlainItem = z.object({ id: ItemId, text: z.string().min(1).max(1000) });
export type PlainItem = z.infer<typeof PlainItem>;

export const ResumeBulletItem = ClaimItem.extend({
  theme: z.string().min(1).max(80),
  /** User curation (S16 bullet cards, D-027): kept at the top / marked as already used. */
  pinned: z.boolean().optional(),
  used: z.boolean().optional(),
});
export type ResumeBulletItem = z.infer<typeof ResumeBulletItem>;

export const ResumeContent = z.object({
  format: z.enum(['bullets', 'narrative']),
  summary: ClaimItem.nullable(),
  /** Bullets (format `bullets`) or paragraphs (format `narrative`). */
  bullets: z.array(ResumeBulletItem).max(12),
});
export type ResumeContent = z.infer<typeof ResumeContent>;

export const AppraisalContent = z.object({
  sections: z.object({
    executiveSummary: ClaimItem,
    keyContributions: z.array(TitledClaim).max(12),
    /** Engine-filled (KPI §8): never written by the model. */
    metrics: z.array(MetricValue),
    areasOfImpact: z.array(ClaimItem).max(10),
    growth: z.array(ClaimItem).max(10),
    nextGoals: z.array(PlainItem).max(10),
  }),
});
export type AppraisalContent = z.infer<typeof AppraisalContent>;

export const PromotionContent = z.object({
  sections: z.object({
    whyReady: ClaimItem,
    leadershipEvidence: z.array(ClaimItem).max(10),
    technicalImpact: z.array(ClaimItem).max(10),
    businessValue: z.array(ClaimItem).max(10),
    mentorship: z.array(ClaimItem).max(10),
    /** Engine-filled (KPI §8). */
    supportingData: z.array(MetricValue),
  }),
});
export type PromotionContent = z.infer<typeof PromotionContent>;

export const ImpactNarrativeContent = z.object({
  summary: ClaimItem,
  highlights: z.array(TitledClaim).max(6),
  focusAreas: z.array(PlainItem).max(4),
});
export type ImpactNarrativeContent = z.infer<typeof ImpactNarrativeContent>;

export const AchievementStatementContent = z.object({
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(1000),
  category: AchievementCategoryWire,
  citations: z.array(EvidenceRef).max(10),
});
export type AchievementStatementContent = z.infer<typeof AchievementStatementContent>;

export const DigestSummaryContent = z.object({
  summary: ClaimItem,
  highlights: z.array(ClaimItem).max(5),
});
export type DigestSummaryContent = z.infer<typeof DigestSummaryContent>;

/** v0.1 documents imported by migration P08-1 (read-only). */
export const LegacyContent = z.object({ legacy: z.literal(true), raw: z.unknown() });
export type LegacyContent = z.infer<typeof LegacyContent>;

export const CONTENT_SCHEMAS = {
  resume: ResumeContent,
  appraisal: AppraisalContent,
  promotion: PromotionContent,
  impact_narrative: ImpactNarrativeContent,
  achievement_statement: AchievementStatementContent,
  digest_summary: DigestSummaryContent,
} as const satisfies Record<DocumentTypeWire, z.ZodType>;

export type DocumentContent =
  | ResumeContent
  | AppraisalContent
  | PromotionContent
  | ImpactNarrativeContent
  | AchievementStatementContent
  | DigestSummaryContent
  | LegacyContent;

/** Sections a user may regenerate on their own (S, F-47). */
export const REGENERABLE_SECTIONS: Record<StudioDocumentType, readonly string[]> = {
  resume: ['summary', 'bullets'],
  appraisal: ['executiveSummary', 'keyContributions', 'areasOfImpact', 'growth', 'nextGoals'],
  promotion: ['whyReady', 'leadershipEvidence', 'technicalImpact', 'businessValue', 'mentorship'],
};

// ── Documents (§13.2, A-3, A-5) ─────────────────────────────────────────────────────────────

export const DocumentFlagCounts = z.object({
  uncited: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
});
export type DocumentFlagCounts = z.infer<typeof DocumentFlagCounts>;

export const DocumentSummary = z.object({
  id: Id,
  type: DocumentTypeWire,
  title: z.string(),
  status: DocumentStatusWire,
  currentVersion: z.number().int(),
  period: ResolvedPeriodDto.nullable(),
  model: z.string(),
  citationCoverage: z.number().nullable(),
  /** A-5: null while the document is not ready. */
  flags: DocumentFlagCounts.nullable(),
  errorCode: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

/** `status` filter values (comma list): the Documents nav spinner asks for `pending,streaming` (GAP-13). */
const StatusList = z
  .string()
  .trim()
  .max(60)
  .transform((value, ctx) => {
    const parts = [
      ...new Set(
        value
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    ];
    const parsed = z.array(DocumentStatusWire).min(1).safeParse(parts);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected pending, streaming, ready, failed or cancelled',
      });
      return z.NEVER;
    }
    return parsed.data;
  });

export const DocumentListQuery = PageQuery.extend({
  type: DocumentTypeWire.optional(),
  status: StatusList.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['-createdAt', '-updatedAt', 'title']).default('-createdAt'),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuery>;

export const DocumentVersionDto = z.object({
  number: z.number().int(),
  source: VersionSourceWire,
  createdAt: Timestamp,
  content: z.unknown(),
});
export type DocumentVersionDto = z.infer<typeof DocumentVersionDto>;

export const DocumentDetail = z.object({
  document: DocumentSummary.extend({
    options: z.unknown(),
    evidenceRefs: z.array(z.string()),
    /** A-3: every ref cited in the version, resolved (deduplicated). */
    evidence: z.array(EvidenceItem),
  }),
  version: DocumentVersionDto.nullable(),
});
export type DocumentDetail = z.infer<typeof DocumentDetail>;

export const DocumentVersionQuery = z.strictObject({
  version: z.coerce.number().int().min(1).optional(),
});

export const CreateDocumentResponse = z.object({
  document: DocumentSummary,
  cached: z.boolean(),
  streamUrl: z.string().nullable(),
});
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;

export const PreviewEvidenceResponse = z.object({
  period: ResolvedPeriodDto,
  counts: z.object({
    prsMerged: z.number().int(),
    prsReviewed: z.number().int(),
    commits: z.number().int(),
    repos: z.number().int(),
    achievements: z.number().int(),
  }),
  topEvidence: z.array(EvidenceItem).max(25),
  metrics: z.array(MetricValue),
  estimatedQuotaCost: z.number().int(),
});
export type PreviewEvidenceResponse = z.infer<typeof PreviewEvidenceResponse>;

export const UpdateDocumentInput = z.strictObject({
  baseVersion: z.number().int().min(0),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.unknown().optional(),
});
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentInput>;

export const RegenerateDocumentInput = z.strictObject({
  /** Changed options (same type); merged over the stored ones. */
  options: z.record(z.string(), z.unknown()).optional(),
  section: z.string().min(1).max(40).optional(),
});
export type RegenerateDocumentInput = z.infer<typeof RegenerateDocumentInput>;

export const VersionParams = z.strictObject({ id: Id, n: z.coerce.number().int().min(1) });

export const DocumentVersionListItem = z.object({
  number: z.number().int(),
  source: VersionSourceWire,
  createdAt: Timestamp,
});

export const VersionListQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── SSE (§13.3) ─────────────────────────────────────────────────────────────────────────────

export const SSE_ERROR_CODES = ['GENERATION_FAILED', 'OUTPUT_INVALID'] as const;

export const DocumentStreamEvents = {
  status: z.object({ status: z.enum(['pending', 'streaming']), version: z.number().int() }),
  section: z.object({ key: z.string(), index: z.number().int(), content: z.unknown() }),
  delta: z.object({ key: z.string(), text: z.string() }),
  done: z.object({
    documentId: Id,
    version: z.number().int(),
    citationCoverage: z.number().nullable(),
    flags: DocumentFlagCounts,
  }),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
  cancelled: z.object({ documentId: Id }),
} as const;
export type DocumentStreamEventName = keyof typeof DocumentStreamEvents;
export type DocumentStreamEvent = {
  [K in DocumentStreamEventName]: { event: K; data: z.infer<(typeof DocumentStreamEvents)[K]> };
}[DocumentStreamEventName];

// ── Impact highlights (§10) ─────────────────────────────────────────────────────────────────

export const HighlightsInput = z.strictObject({
  period: PeriodSpec,
  regenerate: z.boolean().optional(),
});
export type HighlightsInput = z.infer<typeof HighlightsInput>;

export const HighlightsResponse = z.object({
  document: DocumentSummary,
  content: ImpactNarrativeContent,
  evidence: z.array(EvidenceItem),
  cached: z.boolean(),
});
export type HighlightsResponse = z.infer<typeof HighlightsResponse>;

// ── AI utilities (§14) ──────────────────────────────────────────────────────────────────────

export const AchievementStatementInput = z.strictObject({
  source: z.strictObject({ kind: z.enum(['pull_request', 'commit']), id: Id }),
  regenerate: z.boolean().optional(),
});
export type AchievementStatementInput = z.infer<typeof AchievementStatementInput>;

export const AchievementStatementResponse = AchievementStatementContent.extend({
  cached: z.boolean(),
});
export type AchievementStatementResponse = z.infer<typeof AchievementStatementResponse>;

// ── Usage (§5) ──────────────────────────────────────────────────────────────────────────────

export const UsageQuery = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Expected YYYY-MM' })
    .optional(),
});
export type UsageQuery = z.infer<typeof UsageQuery>;

export const AiFeatureWire = z.enum([
  'resume',
  'appraisal',
  'promotion',
  'impact_narrative',
  'achievement_statement',
  'digest_summary',
]);
export type AiFeatureWire = z.infer<typeof AiFeatureWire>;

export const UsageResponse = z.object({
  month: z.string(),
  generations: z.object({ used: z.number().int(), limit: z.number().int(), resetsAt: Timestamp }),
  quick: z.object({ used: z.number().int(), limit: z.number().int() }),
  tokens: z.object({
    input: z.number().int(),
    output: z.number().int(),
    cacheRead: z.number().int(),
  }),
  estimatedCostUsd: z.number(),
  byFeature: z.array(
    z.object({ feature: AiFeatureWire, count: z.number().int(), tokens: z.number().int() }),
  ),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

// ── Exports (§13.2, ADR-0012) ───────────────────────────────────────────────────────────────

export const ExportFormatWire = z.enum(['md', 'txt', 'pdf', 'docx']);
export type ExportFormatWire = z.infer<typeof ExportFormatWire>;

/** `GET /documents/:id/export?format=&version=&citations=` — `citations` defaults per type. */
export const ExportQuery = z.strictObject({
  format: ExportFormatWire,
  version: z.coerce.number().int().min(1).optional(),
  citations: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ExportQuery = z.infer<typeof ExportQuery>;
