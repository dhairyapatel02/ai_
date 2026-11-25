import { Plan } from '@prisma/client';
import { z } from 'zod';

import { AppException } from '../common/app-exception';

/**
 * Plan limits (PRD §6), read by every enforcement point through `limitsFor`. Values can be
 * overridden per plan with `ENTITLEMENTS_JSON` (validated at startup by `config/env.ts`), e.g.
 * `{"FREE":{"aiGenerationsPerMonth":30},"PRO":{"aiQuickPerMonth":2000}}`.
 */
export interface PlanLimits {
  /** Connected data sources across all providers (D-030: FREE 2, PRO 4). */
  integrations: number;
  /** Connections of the same provider (D-030: one account per provider on every plan). */
  integrationsPerProvider: number;
  historyMonths: number;
  aiGenerationsPerMonth: number;
  aiQuickPerMonth: number;
  /** Weekly digest email allowed (PRD §6: both plans). */
  weeklyDigest: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  [Plan.FREE]: {
    integrations: 2,
    integrationsPerProvider: 1,
    historyMonths: 12,
    aiGenerationsPerMonth: 15,
    aiQuickPerMonth: 100,
    weeklyDigest: true,
  },
  [Plan.PRO]: {
    integrations: 4,
    integrationsPerProvider: 1,
    historyMonths: 36,
    aiGenerationsPerMonth: 150,
    aiQuickPerMonth: 1000,
    weeklyDigest: true,
  },
  // Reserved for v2.1 (D-014); behave like PRO until then.
  [Plan.TEAM]: {
    integrations: 4,
    integrationsPerProvider: 1,
    historyMonths: 36,
    aiGenerationsPerMonth: 150,
    aiQuickPerMonth: 1000,
    weeklyDigest: true,
  },
  [Plan.ENTERPRISE]: {
    integrations: 4,
    integrationsPerProvider: 1,
    historyMonths: 36,
    aiGenerationsPerMonth: 150,
    aiQuickPerMonth: 1000,
    weeklyDigest: true,
  },
};

const limit = z.number().int().min(0).max(1_000_000);
export const EntitlementsOverride = z.partialRecord(
  z.enum(Plan),
  z.strictObject({
    integrations: limit.optional(),
    integrationsPerProvider: limit.optional(),
    historyMonths: limit.optional(),
    aiGenerationsPerMonth: limit.optional(),
    aiQuickPerMonth: limit.optional(),
    weeklyDigest: z.boolean().optional(),
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

/**
 * First local date inside the plan's history window (PRD §6): the first day of the month
 * `historyMonths` months before today's month (FREE on 2026-11-24 → 2025-11-01). The sync
 * backfill uses the same window, so older periods would only show missing data.
 */
export function historyWindowStart(plan: Plan, today: string): string {
  const months = limitsFor(plan).historyMonths;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 - months;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

/** `403 ENTITLEMENT_REQUIRED { entitlement, limit, plan }` (API_CONTRACT_V2 §2). */
export function entitlementRequired(
  entitlement: 'history_window' | 'integrations' | 'weekly_digest',
  limit: number,
  plan: Plan,
  message: string,
): AppException {
  return new AppException('ENTITLEMENT_REQUIRED', message, {
    entitlement,
    limit,
    plan: plan.toLowerCase(),
  });
}

/** Rejects a period that starts before the plan's history window. */
export function assertWithinHistory(plan: Plan, startDate: string, today: string): void {
  if (startDate >= historyWindowStart(plan, today)) return;
  const months = limitsFor(plan).historyMonths;
  throw entitlementRequired(
    'history_window',
    months,
    plan,
    `This period starts before your plan's ${months}-month history window`,
  );
}
