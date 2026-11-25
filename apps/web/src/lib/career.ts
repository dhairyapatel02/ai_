import { plural } from '@/lib/format';

import type { CareerTimelineResponse } from '@devimpact/shared';

export type CareerQuarter = CareerTimelineResponse['quarters'][number];
export type CareerRepo = CareerQuarter['repos'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Oct–Dec` for a quarter, or "In progress". */
export function quarterRange(quarter: Pick<CareerQuarter, 'quarter' | 'inProgress'>): string {
  if (quarter.inProgress) return 'In progress';
  const first = (quarter.quarter - 1) * 3;
  return `${MONTHS[first] ?? ''}–${MONTHS[first + 2] ?? ''}`;
}

/** "5 merged · 1 reviewed · 1 achievement" (UX-10 / BUG-13 plurals). */
export function quarterTotals(totals: CareerQuarter['totals']): string {
  const parts = [
    `${totals.prsMerged.toLocaleString('en-US')} merged`,
    `${totals.prsReviewed.toLocaleString('en-US')} reviewed`,
  ];
  if (totals.achievements > 0) parts.push(plural(totals.achievements, 'achievement'));
  if (totals.issuesCompleted > 0)
    parts.push(`${plural(totals.issuesCompleted, 'issue')} completed`);
  return parts.join(' · ');
}

/** "Reviewed 1 pull request by teammates" / "Reviewed 14 pull requests by teammates". */
export function reviewClusterLabel(count: number): string {
  return `Reviewed ${plural(count, 'pull request')} by teammates`;
}

export function isEmptyQuarter(q: CareerQuarter): boolean {
  return (
    q.repos.length === 0 &&
    q.milestones.length === 0 &&
    q.achievements.length === 0 &&
    q.issues.length === 0 &&
    q.totals.prsMerged === 0 &&
    q.totals.prsReviewed === 0
  );
}

/** Items beyond what the server sent (`truncated`): "and N more". */
export function hiddenOnServer(repo: CareerRepo): number {
  return repo.truncated ? Math.max(0, repo.totalItems - repo.items.length) : 0;
}

/** Strips the type prefix of a ref for display: `PR-acme/web-app#12` → `acme/web-app#12`. */
export function displayRef(ref: string): string {
  return ref.replace(/^(PR|REV|C|ACH)-/, '');
}
