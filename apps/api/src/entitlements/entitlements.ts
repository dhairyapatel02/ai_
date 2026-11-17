import { Plan } from '@prisma/client';
import { z } from 'zod';

/**
 * Plan limits (PRD §6), read by every enforcement point through `limitsFor`. Values can be
 * overridden per plan with `ENTITLEMENTS_JSON` (validated at startup by `config/env.ts`), e.g.
 * `{"FREE":{"aiGenerationsPerMonth":30},"PRO":{"aiQuickPerMonth":2000}}`.
 */
export interface PlanLimits {
  integrations: number;
  historyMonths: number;
  aiGenerationsPerMonth: number;
  aiQuickPerMonth: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  [Plan.FREE]: {
    integrations: 1,
    historyMonths: 12,
    aiGenerationsPerMonth: 15,
    aiQuickPerMonth: 100,
  },
  [Plan.PRO]: {
    integrations: 1,
    historyMonths: 36,
    aiGenerationsPerMonth: 150,
    aiQuickPerMonth: 1000,
  },
  // Reserved for v2.1 (D-014); behave like PRO until then.
  [Plan.TEAM]: {
    integrations: 1,
    historyMonths: 36,
    aiGenerationsPerMonth: 150,
    aiQuickPerMonth: 1000,
  },
  [Plan.ENTERPRISE]: {
    integrations: 1,
    historyMonths: 36,
    aiGenerationsPerMonth: 150,
    aiQuickPerMonth: 1000,
  },
};

const limit = z.number().int().min(0).max(1_000_000);
export const EntitlementsOverride = z.partialRecord(
  z.enum(Plan),
  z.strictObject({
    integrations: limit.optional(),
    historyMonths: limit.optional(),
    aiGenerationsPerMonth: limit.optional(),
    aiQuickPerMonth: limit.optional(),
  }),
);

/** Parses `ENTITLEMENTS_JSON`; returns an error message instead of throwing (env validation). */
export function parseEntitlementsOverride(
  json: string | undefined,
): { ok: true; value: z.infer<typeof EntitlementsOverride> } | { ok: false; error: string } {
  if (!json) return { ok: true, value: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'must be valid JSON' };
  }
  const parsed = EntitlementsOverride.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
}

let cache: { json: string | undefined; limits: Record<Plan, PlanLimits> } | null = null;

function effectiveLimits(): Record<Plan, PlanLimits> {
  const json = process.env.ENTITLEMENTS_JSON || undefined;
  if (cache && cache.json === json) return cache.limits;
  const override = parseEntitlementsOverride(json);
  const limits = Object.fromEntries(
    Object.values(Plan).map((plan) => [
      plan,
      { ...PLAN_LIMITS[plan], ...(override.ok ? override.value[plan] : {}) },
    ]),
  ) as Record<Plan, PlanLimits>;
  cache = { json, limits };
  return limits;
}

export function limitsFor(plan: Plan): PlanLimits {
  return effectiveLimits()[plan];
}
