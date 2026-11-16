import { Plan } from '@prisma/client';

/**
 * Plan limits (PRD §6). Enforcement of the AI quotas and the `ENTITLEMENTS_JSON` override land
 * with P08/P12; P05 enforces the integration limit on connect.
 */
export const PLAN_LIMITS: Record<
  Plan,
  {
    integrations: number;
    historyMonths: number;
    aiGenerationsPerMonth: number;
    aiQuickPerMonth: number;
  }
> = {
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

export function limitsFor(plan: Plan) {
  return PLAN_LIMITS[plan];
}
