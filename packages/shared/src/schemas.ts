import { z } from 'zod';

export const dateRangeSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).or(z.iso.date()),
  to: z.iso.datetime({ offset: true }).or(z.iso.date()),
});

/**
 * v1 generation bodies (`POST /generate/*`, replaced by `POST /documents` in P08). Strict objects
 * with bounded lengths so garbage input is rejected before any paid LLM call (BUG-07, SEC-07).
 */
export const generateResumeSchema = z.strictObject({
  dateRange: dateRangeSchema,
  role: z.enum(['backend', 'frontend', 'fullstack', 'devops', 'manager']),
  format: z.enum(['bullets', 'narrative']).optional().default('bullets'),
});

export const generateAppraisalSchema = z.strictObject({
  period: z.enum(['monthly', 'quarterly', 'yearly']),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

export const generatePromotionSchema = z.strictObject({
  currentRole: z.string().trim().min(1).max(100),
  targetRole: z.string().trim().min(1).max(100),
});

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

export const dateFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

/** One AI-generated resume bullet (BUG-14: shared contract between API and web). */
export const resumeBulletSchema = z.object({
  text: z.string().min(1),
  category: z.string().default(''),
  impact: z.string().default(''),
});

/** Shape the resume prompt asks the model to return. */
export const resumeBulletsResultSchema = z.object({
  bullets: z.array(resumeBulletSchema),
});

export type ResumeBulletOutput = z.infer<typeof resumeBulletSchema>;
