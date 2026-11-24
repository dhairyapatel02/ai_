import { z } from 'zod';

import { Id, IntegrationStatus, PeriodTypeWire, PlanWire, Timestamp } from './common';

/** API_CONTRACT_V2 §3.5 / §5. */
export const UserDto = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  image: z.url().nullable(),
  plan: PlanWire,
  createdAt: Timestamp,
});
export type UserDto = z.infer<typeof UserDto>;

/** True when `tz` is an IANA time zone known to this runtime (D-019). */
export function isValidTimeZone(tz: string): boolean {
  if (tz === 'UTC') return true;
  try {
    return Intl.supportedValuesOf('timeZone').includes(tz) || isAcceptedByIntl(tz);
  } catch {
    return isAcceptedByIntl(tz);
  }
}

function isAcceptedByIntl(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz);
  } catch {
    return false;
  }
}

export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: 'Must be an IANA time zone, e.g. Europe/Berlin' });

export const SettingsDto = z.object({
  timezone: z.string(),
  currentRole: z.string().nullable(),
  careerLevel: z.string().nullable(),
  targetRole: z.string().nullable(),
  defaultPeriodType: PeriodTypeWire,
  digestEnabled: z.boolean(),
  digestDayOfWeek: z.number().int().min(1).max(7),
  digestHourLocal: z.number().int().min(0).max(23),
  notifySyncFailures: z.boolean(),
  notifyDocumentReady: z.boolean(),
  aiRedactPrivateRepos: z.boolean(),
  onboardingStep: z.string().nullable(),
  onboardingCompletedAt: Timestamp.nullable(),
});
export type SettingsDto = z.infer<typeof SettingsDto>;

const optionalText = z.string().trim().min(1).max(100).nullable().optional();

/** `PATCH /me/settings` body: every field optional, unknown keys rejected. */
export const UpdateSettingsInput = z.strictObject({
  timezone: TimeZone.optional(),
  currentRole: optionalText,
  careerLevel: optionalText,
  targetRole: optionalText,
  defaultPeriodType: PeriodTypeWire.optional(),
  digestEnabled: z.boolean().optional(),
  digestDayOfWeek: z.number().int().min(1).max(7).optional(),
  digestHourLocal: z.number().int().min(0).max(23).optional(),
  notifySyncFailures: z.boolean().optional(),
  notifyDocumentReady: z.boolean().optional(),
  aiRedactPrivateRepos: z.boolean().optional(),
  onboardingStep: z.string().trim().min(1).max(50).nullable().optional(),
  onboardingCompleted: z.boolean().optional(),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;

export const UpdateMeInput = z.strictObject({ name: z.string().trim().min(1).max(100) });
export type UpdateMeInput = z.infer<typeof UpdateMeInput>;

export const DeleteMeInput = z.strictObject({ confirmEmail: z.email() });
export type DeleteMeInput = z.infer<typeof DeleteMeInput>;

export const Entitlements = z.object({
  plan: PlanWire,
  limits: z.object({
    integrations: z.number().int(),
    historyMonths: z.number().int(),
    aiGenerationsPerMonth: z.number().int(),
    aiQuickPerMonth: z.number().int(),
    weeklyDigest: z.boolean(),
  }),
  usage: z.object({ integrations: z.number().int() }),
});
export type Entitlements = z.infer<typeof Entitlements>;

export const IntegrationSummary = z.object({
  id: Id,
  provider: z.literal('github'),
  status: IntegrationStatus,
  externalLogin: z.string().nullable(),
  lastSuccessfulSyncAt: Timestamp.nullable(),
});
export type IntegrationSummary = z.infer<typeof IntegrationSummary>;

export const MeDto = z.object({
  user: UserDto,
  settings: SettingsDto,
  entitlements: Entitlements,
  integrations: z.array(IntegrationSummary),
  onboarding: z.object({ step: z.string().nullable(), completed: z.boolean() }),
});
export type MeDto = z.infer<typeof MeDto>;
