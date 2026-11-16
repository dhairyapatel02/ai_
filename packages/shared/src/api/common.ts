import { z } from 'zod';

/**
 * API contract primitives (API_CONTRACT_V2 §1–§3, ADR-0006). Used by the API validation pipe,
 * the OpenAPI generator and the web client.
 */

/** Stable error codes (API_CONTRACT_V2 §2). Adding a code is additive; renaming one is breaking. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_PERIOD',
  'OAUTH_STATE_INVALID',
  'OAUTH_DENIED',
  'UNAUTHENTICATED',
  'WEBHOOK_SIGNATURE_INVALID',
  'QUOTA_EXCEEDED',
  'FORBIDDEN',
  'ENTITLEMENT_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'SYNC_IN_PROGRESS',
  'INTEGRATION_ACCOUNT_IN_USE',
  'INTEGRATION_NEEDS_REAUTH',
  'GENERATION_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
  'UPSTREAM_ERROR',
  'UPSTREAM_UNAVAILABLE',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Default HTTP status per error code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_PERIOD: 400,
  OAUTH_STATE_INVALID: 400,
  OAUTH_DENIED: 400,
  UNAUTHENTICATED: 401,
  WEBHOOK_SIGNATURE_INVALID: 401,
  QUOTA_EXCEEDED: 402,
  FORBIDDEN: 403,
  ENTITLEMENT_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  SYNC_IN_PROGRESS: 409,
  INTEGRATION_ACCOUNT_IN_USE: 409,
  INTEGRATION_NEEDS_REAUTH: 409,
  GENERATION_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_ERROR: 502,
  UPSTREAM_UNAVAILABLE: 503,
};

/** Resource ids are Prisma cuids (`c` + 24 chars). Malformed ids are rejected before any query. */
export const Id = z.string().regex(/^c[0-9a-z]{20,31}$/, { message: 'Invalid id' });
export const LocalDate = z.iso.date();
export const Timestamp = z.iso.datetime();
export const Cursor = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

export const PageQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const PageMeta = z.object({
  nextCursor: Cursor.nullable(),
  hasMore: z.boolean(),
  total: z.number().int().nonnegative().optional(),
});
export type PageMeta = z.infer<typeof PageMeta>;

export const IdParams = z.strictObject({ id: Id });

export const Envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    meta: z.record(z.string(), z.unknown()).optional(),
  });

export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const ErrorEnvelope = z.object({ success: z.literal(false), error: ErrorBody });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** Details shape of `VALIDATION_FAILED`. */
export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/** Wire enums (lower-case mirrors of Prisma enums, API_CONTRACT_V2 §3.2). */
export const IntegrationStatus = z.enum([
  'active',
  'needs_reauth',
  'suspended',
  'disconnected',
  'error',
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;
export const PlanWire = z.enum(['free', 'pro', 'team', 'enterprise']);
export type PlanWire = z.infer<typeof PlanWire>;
export const PeriodTypeWire = z.enum(['month', 'quarter', 'half', 'year']);
export type PeriodTypeWire = z.infer<typeof PeriodTypeWire>;

/**
 * Query string boolean (`true`/`false`). `z.coerce.boolean()` would turn "false" into `true`.
 */
export const QueryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');
