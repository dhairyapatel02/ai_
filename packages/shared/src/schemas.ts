import { z } from 'zod';

export const dateRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).or(z.string().date()),
  to: z.string().datetime({ offset: true }).or(z.string().date()),
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

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  ANTHROPIC_API_KEY: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  PORT: z.coerce.number().optional().default(4000),
});
