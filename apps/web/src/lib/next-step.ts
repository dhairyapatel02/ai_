import { periodSpecContaining, resolvePeriod } from '@devimpact/shared';

/**
 * Dashboard "Next step" rules (SCREENS S6, F-24): first match wins, evaluated on the client.
 * Rules 4 (achievements) and 6 (goals) need the P12 endpoints and are skipped until they exist.
 */
export type NextStepRule = 'reconnect' | 'sync_failed' | 'appraisal' | 'resume' | 'impact';

export interface NextStepInput {
  today: string;
  timezone: string;
  defaultPeriodType: 'month' | 'quarter' | 'half' | 'year';
  /** Integration `needs_reauth` or a suspended installation. */
  needsReconnect: boolean;
  suspendedOrg: string | null;
  lastSyncFailed: boolean;
  /** Appraisals (period spec of each, newest first); null while loading or unavailable. */
  appraisalPeriods: (string | null)[] | null;
  /** Newest resume document's creation time, `undefined` when none exists. */
  newestResumeAt: string | null | undefined;
  /** Rules hidden with "Not now" until their expiry (epoch ms). */
  dismissed: Partial<Record<NextStepRule, number>>;
  now: number;
}

export interface NextStep {
  rule: NextStepRule;
  /** Half / quarter spec for the appraisal rule. */
  periodSpec?: string;
  periodLabel?: string;
  daysLeft?: number;
}

const DAY = 86_400_000;

export function appraisalTarget(
  today: string,
  timezone: string,
  type: NextStepInput['defaultPeriodType'],
) {
  const spec = periodSpecContaining(type === 'quarter' ? 'quarter' : 'half', today);
  const period = resolvePeriod(spec, timezone, today);
  // Full calendar end of the period (resolvePeriod clips in-progress periods to today).
  const start = Date.parse(`${period.startDate}T00:00:00Z`);
  const end = start + (period.periodDays - 1) * DAY;
  const daysLeft = Math.round((end - Date.parse(`${today}T00:00:00Z`)) / DAY);
  return { spec, label: period.label, startDate: period.startDate, daysLeft };
}

export function pickNextStep(input: NextStepInput): NextStep {
  const hidden = (rule: NextStepRule) => (input.dismissed[rule] ?? 0) > input.now;
  if (input.needsReconnect && !hidden('reconnect')) return { rule: 'reconnect' };
  if (input.lastSyncFailed && !hidden('sync_failed')) return { rule: 'sync_failed' };
  if (input.appraisalPeriods && !hidden('appraisal')) {
    const target = appraisalTarget(input.today, input.timezone, input.defaultPeriodType);
    if (target.daysLeft <= 60 && !input.appraisalPeriods.includes(target.spec)) {
      return {
        rule: 'appraisal',
        periodSpec: target.spec,
        periodLabel: target.label,
        daysLeft: target.daysLeft,
      };
    }
  }
  if (
    input.newestResumeAt &&
    input.now - Date.parse(input.newestResumeAt) > 90 * DAY &&
    !hidden('resume')
  ) {
    return { rule: 'resume' };
  }
  return { rule: 'impact' };
}

const STORAGE_KEY = 'devimpact.nextStep.dismissed.v1';

/** "Not now" memory (IA §6: localStorage, per device). Never throws (private mode). */
export function readDismissed(): Partial<Record<NextStepRule, number>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'number'),
    );
  } catch {
    return {};
  }
}

export function dismissRule(
  rule: NextStepRule,
  now = Date.now(),
): Partial<Record<NextStepRule, number>> {
  const next = { ...readDismissed(), [rule]: now + 7 * DAY };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the card is hidden for this page view only.
  }
  return next;
}
