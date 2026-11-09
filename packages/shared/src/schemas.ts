import { z } from 'zod';

export const dateRangeSchema = z.object({
  from: z.iso.datetime({ offset: true }).or(z.iso.date()),
  to: z.iso.datetime({ offset: true }).or(z.iso.date()),
});

export const generateResumeSchema = z.object({
  dateRange: dateRangeSchema,
  role: z.enum(['backend', 'frontend', 'fullstack', 'devops', 'manager']),
  format: z.enum(['bullets', 'narrative']).optional().default('bullets'),
});

export const generateAppraisalSchema = z.object({
  period: z.enum(['monthly', 'quarterly', 'yearly']),
  month: z.number().min(1).max(12),
  year: z.number().min(2020).max(2030),
});

export const generatePromotionSchema = z.object({
  currentRole: z.string().min(1).max(100),
  targetRole: z.string().min(1).max(100),
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
