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
  /** Issues completed that day (§3.6, metrics@2.1.0) and their story points. */
  issuesCompleted: number;
  storyPoints: number;
  /** Per-provider counters (P13 provider dimension); providers without activity are omitted. */
  byProvider: Record<string, ProviderCounters>;
  active: boolean;
}

export interface ProviderCounters {
  commits: number;
  prsMerged: number;
  prsReviewed: number;
  issuesCompleted: number;
  storyPoints: number;
}

const emptyProvider = (): ProviderCounters => ({
  commits: 0,
  prsMerged: 0,
  prsReviewed: 0,
  issuesCompleted: 0,
  storyPoints: 0,
});

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
    issuesCompleted: 0,
    storyPoints: 0,
    byProvider: {},
    active: false,
  };
}

function providerRow(row: DailyCounters, provider: string | undefined): ProviderCounters {
  const key = provider ?? 'github';
  return (row.byProvider[key] ??= emptyProvider());
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
  const reviewedByProvider = new Map<string, Set<string>>();
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
      providerRow(row, c.provider).commits++;
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
      if (merged) {
        merged.prsMerged++;
        providerRow(merged, p.provider).prsMerged++;
      }
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
    const key = `${row.date}|${r.provider ?? 'github'}`;
    let byProvider = reviewedByProvider.get(key);
    if (!byProvider) {
      byProvider = new Set();
      reviewedByProvider.set(key, byProvider);
    }
    byProvider.add(r.pullRequestId);
  }
  for (const i of facts.issues ?? []) {
    if (!i.completedAt) continue;
    const row = day(i.completedAt);
    if (!row) continue;
    row.issuesCompleted++;
    row.storyPoints += i.storyPoints ?? 0;
    const provider = providerRow(row, i.provider);
    provider.issuesCompleted++;
    provider.storyPoints += i.storyPoints ?? 0;
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
  for (const [key, prs] of reviewedByProvider) {
    const [date, provider] = key.split('|');
    const row = days.get(date);
    if (row) providerRow(row, provider).prsReviewed = prs.size;
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
