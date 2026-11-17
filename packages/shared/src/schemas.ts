import { z } from 'zod';

export const dateRangeSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).or(z.iso.date()),
  to: z.iso.datetime({ offset: true }).or(z.iso.date()),
});

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

export const dateFilterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
