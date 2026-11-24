import { localDateOf } from '@devimpact/shared';

import type { Facts } from './metric-definitions';

/**
 * Daily rollup counters (KPI_METHODOLOGY §4) — pure. One entry per local date in `[fromDate,
 * toDate]` that has at least one counted event; dates without activity are omitted (read paths
 * fill zeros). `prsReviewed` is the number of distinct PRs reviewed that day.
 */
export interface DailyCounters {
  date: string;
  commits: number;
  prsOpened: number;
  prsMerged: number;
  prsClosedUnmerged: number;
  reviewsSubmitted: number;
  prsReviewed: number;
  reviewComments: number;
  achievements: number;
  active: boolean;
}

export function emptyCounters(date: string): DailyCounters {
  return {
    date,
    commits: 0,
    prsOpened: 0,
    prsMerged: 0,
    prsClosedUnmerged: 0,
    reviewsSubmitted: 0,
    prsReviewed: 0,
    reviewComments: 0,
    achievements: 0,
    active: false,
  };
}

export function rollupDays(
  facts: Facts,
  fromDate: string,
  toDate: string,
  timeZone: string,
  /** Local `occurredOn` dates of the user's achievements (counter only; not an "active" day). */
  achievementDates: readonly string[] = [],
): DailyCounters[] {
  const days = new Map<string, DailyCounters>();
  const reviewedPrs = new Map<string, Set<string>>();
  const day = (at: Date): DailyCounters | null => {
    const date = localDateOf(at, timeZone);
    if (date < fromDate || date > toDate) return null;
    let row = days.get(date);
    if (!row) {
      row = emptyCounters(date);
      days.set(date, row);
    }
    return row;
  };

  for (const c of facts.commits) {
    const row = day(c.authoredAt);
    if (row) {
      row.commits++;
      row.active = true;
    }
  }
  for (const p of facts.authored) {
    const opened = day(p.createdAt);
    if (opened) {
      opened.prsOpened++;
      opened.active = true;
    }
    if (p.mergedAt) {
      const merged = day(p.mergedAt);
      if (merged) merged.prsMerged++;
    } else if (p.closedAt) {
      const closed = day(p.closedAt);
      if (closed) closed.prsClosedUnmerged++;
    }
  }
  for (const r of facts.reviews) {
    const row = day(r.submittedAt);
    if (!row) continue;
    row.reviewsSubmitted++;
    row.reviewComments += r.commentsCount + (r.hasBody ? 1 : 0);
    row.active = true;
    let prs = reviewedPrs.get(row.date);
    if (!prs) {
      prs = new Set();
      reviewedPrs.set(row.date, prs);
    }
    prs.add(r.pullRequestId);
  }
  for (const date of achievementDates) {
    if (date < fromDate || date > toDate) continue;
    let row = days.get(date);
    if (!row) {
      row = emptyCounters(date);
      days.set(date, row);
    }
    row.achievements++;
  }
  for (const [date, prs] of reviewedPrs) {
    const row = days.get(date);
    if (row) row.prsReviewed = prs.size;
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
