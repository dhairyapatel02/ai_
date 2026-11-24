import {
  AchievementCategoryWire,
  type AchievementDto,
  type EvidenceItem,
  type GoalDto,
  type MetricUnit,
} from '@devimpact/shared';

/** Category order and labels (S17 chips, dialog select, badges). Shared by server and client. */
export const ACHIEVEMENT_CATEGORIES = AchievementCategoryWire.options;
export const CATEGORY_LABEL: Record<AchievementCategoryWire, string> = {
  delivery: 'Delivery',
  quality: 'Quality',
  mentoring: 'Mentoring',
  incident: 'Incident',
  leadership: 'Leadership',
  learning: 'Learning',
  collaboration: 'Collaboration',
  other: 'Other',
};

export function parseCategory(
  value: string | null | undefined,
): AchievementCategoryWire | undefined {
  const parsed = AchievementCategoryWire.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Groups achievements (newest first) by local month: `[["November 2026", [...]], …]`. */
export function groupByMonth(items: AchievementDto[]): [string, AchievementDto[]][] {
  const groups: [string, AchievementDto[]][] = [];
  for (const a of items) {
    const label = `${MONTHS[Number(a.occurredOn.slice(5, 7)) - 1] ?? ''} ${a.occurredOn.slice(0, 4)}`;
    const last = groups[groups.length - 1];
    if (last?.[0] === label) last[1].push(a);
    else groups.push([label, [a]]);
  }
  return groups;
}

/** Evidence linked in the dialog (pre-filled from a PR/commit or picked from the feed). */
export interface LinkedEvidence {
  kind: 'pull_request' | 'commit' | 'review';
  id: string;
  ref: string;
  title: string;
}

export function linkedFromEvidence(items: EvidenceItem[]): LinkedEvidence[] {
  return items.flatMap((e) =>
    e.kind === 'achievement' ? [] : [{ kind: e.kind, id: e.id, ref: e.ref, title: e.title }],
  );
}

/** What the add/edit dialog starts with. `draftedFrom` = AI draft from this ref (S7). */
export interface AchievementPrefill {
  title?: string;
  category?: AchievementCategoryWire;
  occurredOn?: string;
  impact?: string;
  evidence?: LinkedEvidence[];
  source?: 'manual' | 'from_activity' | 'suggested';
  draftedFrom?: string;
}

/** `PR-acme/api#12` → `acme/api #12`, `C-acme/api@abc1234` → `acme/api abc1234`. */
export function shortRef(ref: string): string {
  return ref
    .replace(/^(PR|REV|C|ACH)-/, '')
    .replace('#', ' #')
    .replace('@', ' ');
}

// ── Goals (S18) ────────────────────────────────────────────────────────────────────────

export const GOAL_STATUS_LABEL: Record<GoalDto['progress']['status'], string> = {
  met: 'On target',
  not_met: 'Not yet',
  no_data: 'Not enough data',
  no_metric: 'Tracked by achievements',
};

/** A target value as the user types it: hours, percent (ratios ×100) or a count. */
export function toDisplayValue(unit: MetricUnit, value: number): number {
  return unit === 'ratio' ? Math.round(value * 1000) / 10 : value;
}
export function fromDisplayValue(unit: MetricUnit, value: number): number {
  return unit === 'ratio' ? value / 100 : value;
}

export function unitSuffix(unit: MetricUnit): string {
  return unit === 'hours' ? 'h' : unit === 'ratio' ? '%' : '';
}

/** "8.0 h", "75%", "4". */
export function formatTarget(unit: MetricUnit, value: number): string {
  if (unit === 'hours') return `${value.toFixed(1)} h`;
  if (unit === 'ratio') return `${toDisplayValue(unit, value).toLocaleString('en-US')}%`;
  return value.toLocaleString('en-US');
}

/** Width (0–100) of a goal's progress bar. */
export function goalProgressPct(goal: GoalDto): number {
  const { current, target, status } = goal.progress;
  if (status === 'no_metric') return Math.min(100, goal.achievementIds.length * 25);
  if (current === null || target === null) return 0;
  const cmp = goal.metricTarget?.comparator;
  const pct =
    cmp === 'gte'
      ? (current / Math.max(target, 0.0001)) * 100
      : (target / Math.max(current, 0.0001)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
