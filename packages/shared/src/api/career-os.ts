import { z } from 'zod';

import { Id, LocalDate, PageQuery, Timestamp } from './common';
import { AchievementCategoryWire } from './documents';
import {
  EvidenceItem,
  EvidenceRef,
  ImplementedMetricKeyWire,
  PeriodSpec,
  ResolvedPeriodDto,
} from './metrics';

/**
 * Career OS contracts (API_CONTRACT_V2 §15 Achievements, §16 Goals, §17 Notifications). Phase 12.
 * Achievements are private to their owner (no visibility field in v2.0; share links are v2.1).
 */

// ── Achievements (§15) ──────────────────────────────────────────────────────────────────────

export const AchievementSourceWire = z.enum(['manual', 'from_activity', 'suggested']);
export type AchievementSourceWire = z.infer<typeof AchievementSourceWire>;

export const AchievementEvidenceKindWire = z.enum(['pull_request', 'commit', 'review']);
export type AchievementEvidenceKindWire = z.infer<typeof AchievementEvidenceKindWire>;

/** Only http(s) links are stored (the UI renders them as links). */
export const HttpUrl = z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' }).max(2000);

export const AchievementLink = z.strictObject({
  url: HttpUrl,
  label: z.string().trim().max(100).optional(),
});
export type AchievementLink = z.infer<typeof AchievementLink>;

export const AchievementEvidenceInput = z.strictObject({
  kind: AchievementEvidenceKindWire,
  id: Id,
});

const achievementFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  impact: z.string().trim().max(1000).nullable().optional(),
  category: AchievementCategoryWire,
  occurredOn: LocalDate,
  links: z.array(AchievementLink).max(10),
  evidence: z.array(AchievementEvidenceInput).max(50),
  source: AchievementSourceWire,
};

export const AchievementInput = z.strictObject({
  ...achievementFields,
  links: achievementFields.links.default([]),
  evidence: achievementFields.evidence.default([]),
  source: achievementFields.source.default('manual'),
});
export type AchievementInput = z.input<typeof AchievementInput>;
export type AchievementInputParsed = z.infer<typeof AchievementInput>;

export const UpdateAchievementInput = z
  .strictObject({
    title: achievementFields.title.optional(),
    description: achievementFields.description,
    impact: achievementFields.impact,
    category: achievementFields.category.optional(),
    occurredOn: achievementFields.occurredOn.optional(),
    links: achievementFields.links.optional(),
    evidence: achievementFields.evidence.optional(),
    source: achievementFields.source.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' });
export type UpdateAchievementInput = z.infer<typeof UpdateAchievementInput>;

export const AchievementDto = z.object({
  id: Id,
  ref: EvidenceRef,
  title: z.string(),
  description: z.string().nullable(),
  impact: z.string().nullable(),
  category: AchievementCategoryWire,
  occurredOn: LocalDate,
  links: z.array(z.object({ url: z.string(), label: z.string().optional() })),
  source: AchievementSourceWire,
  /** Linked PRs / reviews / commits (purged activity disappears with it — FK cascade). */
  evidence: z.array(EvidenceItem),
  goalIds: z.array(Id),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type AchievementDto = z.infer<typeof AchievementDto>;

export const AchievementListQuery = PageQuery.extend({
  period: PeriodSpec.optional(),
  category: AchievementCategoryWire.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type AchievementListQuery = z.infer<typeof AchievementListQuery>;

export const DeletedResponse = z.object({ deleted: z.literal(true) });
export type DeletedResponse = z.infer<typeof DeletedResponse>;

// ── Goals (§16) ─────────────────────────────────────────────────────────────────────────────

export const GoalStatusWire = z.enum(['active', 'achieved', 'missed', 'archived']);
export type GoalStatusWire = z.infer<typeof GoalStatusWire>;
export const GoalComparatorWire = z.enum(['lte', 'gte']);
export type GoalComparatorWire = z.infer<typeof GoalComparatorWire>;

export const MetricTarget = z.strictObject({
  metricKey: ImplementedMetricKeyWire,
  comparator: GoalComparatorWire,
  targetValue: z.number().min(0).max(1_000_000),
});
export type MetricTarget = z.infer<typeof MetricTarget>;

const goalFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  startDate: LocalDate,
  targetDate: LocalDate.nullable().optional(),
  status: GoalStatusWire,
  metricTarget: MetricTarget.nullable().optional(),
  achievementIds: z.array(Id).max(100),
};

const targetAfterStart = (v: { startDate?: string; targetDate?: string | null }) =>
  !v.startDate || !v.targetDate || v.targetDate >= v.startDate;

export const GoalInput = z
  .strictObject({
    ...goalFields,
    status: goalFields.status.default('active'),
    achievementIds: goalFields.achievementIds.default([]),
  })
  .refine(targetAfterStart, {
    message: 'The target date must not be before the start date',
    path: ['targetDate'],
  });
export type GoalInput = z.input<typeof GoalInput>;
export type GoalInputParsed = z.infer<typeof GoalInput>;

export const UpdateGoalInput = z
  .strictObject({
    title: goalFields.title.optional(),
    description: goalFields.description,
    startDate: goalFields.startDate.optional(),
    targetDate: goalFields.targetDate,
    status: goalFields.status.optional(),
    metricTarget: goalFields.metricTarget,
    achievementIds: goalFields.achievementIds.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' })
  .refine(targetAfterStart, {
    message: 'The target date must not be before the start date',
    path: ['targetDate'],
  });
export type UpdateGoalInput = z.infer<typeof UpdateGoalInput>;

export const GoalProgressStatus = z.enum(['met', 'not_met', 'no_data', 'no_metric']);
export type GoalProgressStatus = z.infer<typeof GoalProgressStatus>;

export const GoalProgress = z.object({
  current: z.number().nullable(),
  target: z.number().nullable(),
  status: GoalProgressStatus,
  evaluatedPeriod: ResolvedPeriodDto.nullable(),
});
export type GoalProgress = z.infer<typeof GoalProgress>;

export const GoalDto = z.object({
  id: Id,
  title: z.string(),
  description: z.string().nullable(),
  status: GoalStatusWire,
  startDate: LocalDate,
  targetDate: LocalDate.nullable(),
  metricTarget: MetricTarget.nullable(),
  achievementIds: z.array(Id),
  progress: GoalProgress,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type GoalDto = z.infer<typeof GoalDto>;

export const GoalDetailDto = GoalDto.extend({ achievements: z.array(AchievementDto) });
export type GoalDetailDto = z.infer<typeof GoalDetailDto>;

export const GoalListQuery = PageQuery.extend({ status: GoalStatusWire.optional() });
export type GoalListQuery = z.infer<typeof GoalListQuery>;

// ── Notifications (§17) ─────────────────────────────────────────────────────────────────────

export const UnsubscribeList = z.enum(['digest', 'all']);
export type UnsubscribeList = z.infer<typeof UnsubscribeList>;

export const UnsubscribeInput = z.strictObject({
  token: z
    .string()
    .min(10)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, { message: 'Malformed token' }),
});
export type UnsubscribeInput = z.infer<typeof UnsubscribeInput>;

export const UnsubscribeResponse = z.object({
  unsubscribed: z.literal(true),
  list: UnsubscribeList,
});
export type UnsubscribeResponse = z.infer<typeof UnsubscribeResponse>;

export const DigestPreviewResponse = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  weekStart: LocalDate,
});
export type DigestPreviewResponse = z.infer<typeof DigestPreviewResponse>;
