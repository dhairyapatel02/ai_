import {
  localDateOf,
  localRangeToUtc,
  todayIn,
  type CareerTimelineResponse,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';

import { REPO_PROVIDER, issueRef, prRef, reviewRef, safeUrl } from '../common/evidence-refs';
import { PrismaService } from '../prisma/prisma.service';
import { computeMetric } from './metric-definitions';
import { MetricsRepository } from './metrics.repository';

export const CAREER_ITEMS_PER_REPO = 50;

type Quarter = CareerTimelineResponse['quarters'][number];
type RepoGroup = Quarter['repos'][number];

/**
 * `GET /career/timeline` (API_CONTRACT_V2 §12, F-30): the year by quarter — merged PRs per
 * repository, one review cluster per repository, achievements ("Beyond code"), milestones and totals. Server-side aggregation
 * over included repositories only (fixes PERF-03's client-side 200-row truncation; no reviewed-PR
 * stubs or commit-count cards, UX-10/DATA-01).
 */
@Injectable()
export class CareerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MetricsRepository,
  ) {}

  async timeline(
    userId: string,
    requestedYear?: number,
    now = new Date(),
  ): Promise<CareerTimelineResponse> {
    const { timezone } = await this.repo.settings(userId);
    const today = todayIn(timezone, now);
    const currentYear = Number(today.slice(0, 4));
    const year = requestedYear ?? currentYear;

    const years = await this.prisma.$queryRaw<{ y: number }[]>`
      SELECT DISTINCT y::int AS y FROM (
        SELECT EXTRACT(YEAR FROM (p."mergedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}) AS y
        FROM pull_requests p JOIN repositories r ON r.id = p.repository_id AND r.included
        WHERE p."userId" = ${userId} AND p.is_authored_by_user AND NOT p.legacy_stub
          AND p."mergedAt" IS NOT NULL
        UNION
        SELECT EXTRACT(YEAR FROM (v.submitted_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}) AS y
        FROM pull_request_reviews v
        JOIN pull_requests p ON p.id = v.pull_request_id AND NOT p.is_authored_by_user AND NOT p.legacy_stub
        JOIN repositories r ON r.id = p.repository_id AND r.included
        WHERE v.user_id = ${userId}
        UNION
        SELECT EXTRACT(YEAR FROM a.occurred_on) AS y
        FROM achievements a WHERE a.user_id = ${userId}
      ) years ORDER BY y DESC`;

    const { start, endExclusive } = localRangeToUtc(`${year}-01-01`, `${year}-12-31`, timezone);
    const included = { included: true } as const;
    const [mergedRows, reviews, firstMerges, facts, achievementRows, issueRows] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where: {
          userId,
          isAuthoredByUser: true,
          legacyStub: false,
          repository: included,
          mergedAt: { gte: start, lt: endExclusive },
        },
        select: {
          id: true,
          number: true,
          title: true,
          url: true,
          labels: true,
          mergedAt: true,
          additions: true,
          deletions: true,
          repositoryId: true,
          repository: { select: { fullName: true, ...REPO_PROVIDER } },
        },
        orderBy: [{ mergedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.pullRequestReview.findMany({
        where: {
          userId,
          submittedAt: { gte: start, lt: endExclusive },
          pullRequest: { isAuthoredByUser: false, legacyStub: false, repository: included },
        },
        select: {
          id: true,
          submittedAt: true,
          pullRequestId: true,
          pullRequest: {
            select: {
              number: true,
              repositoryId: true,
              repository: { select: { fullName: true, ...REPO_PROVIDER } },
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.pullRequest.groupBy({
        by: ['repositoryId'],
        where: {
          userId,
          isAuthoredByUser: true,
          legacyStub: false,
          repository: included,
          mergedAt: { not: null },
        },
        _min: { mergedAt: true },
      }),
      this.repo.loadFacts(userId, start, endExclusive),
      this.prisma.achievement.findMany({
        where: {
          userId,
          occurredOn: {
            gte: new Date(`${year}-01-01T00:00:00.000Z`),
            lte: new Date(`${year}-12-31T00:00:00.000Z`),
          },
        },
        select: { id: true, title: true, category: true, occurredOn: true },
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      }),
      // Issues completed in the year (Jira / Linear, P13, A-8).
      this.prisma.issue.findMany({
        where: { userId, status: 'DONE', completedAt: { gte: start, lt: endExclusive } },
        select: {
          id: true,
          key: true,
          title: true,
          url: true,
          completedAt: true,
          storyPoints: true,
          projectName: true,
          integration: { select: { provider: true } },
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const achievementsAll = achievementRows.map((a) => ({
      type: 'achievement' as const,
      id: a.id,
      ref: `ACH-${a.id}`,
      title: a.title,
      date: a.occurredOn.toISOString().slice(0, 10),
      url: null,
      tags: [a.category.toLowerCase()],
    }));
    const merged = mergedRows.flatMap((p) =>
      p.mergedAt
        ? [
            {
              ...p,
              mergedAt: p.mergedAt,
              size: p.additions !== null && p.deletions !== null ? p.additions + p.deletions : null,
            },
          ]
        : [],
    );
    const firstMergeAt = new Map(
      firstMerges.map((g) => [g.repositoryId, g._min.mergedAt?.getTime() ?? null]),
    );

    const lastQuarter =
      year < currentYear ? 4 : year > currentYear ? 0 : Math.ceil(Number(today.slice(5, 7)) / 3);
    const quarters: Quarter[] = [];
    for (let q = lastQuarter; q >= 1; q--) {
      const qStart = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
      const qEndMonth = q * 3;
      const qEnd = new Date(Date.UTC(year, qEndMonth, 0)).toISOString().slice(0, 10);
      const inProgress = today >= qStart && today <= qEnd;
      const displayEnd = inProgress ? today : qEnd;
      const range = localRangeToUtc(qStart, displayEnd, timezone);
      const inQ = (t: Date) => t >= range.start && t < range.endExclusive;

      const qMerged = merged.filter((p) => inQ(p.mergedAt));
      const qAchievements = achievementsAll.filter((a) => a.date >= qStart && a.date <= qEnd);
      const qReviews = reviews.filter((r) => inQ(r.submittedAt));
      const qIssues = issueRows.filter((i) => i.completedAt !== null && inQ(i.completedAt));
      const groups = new Map<
        string,
        { fullName: string; provider: string; prs: typeof qMerged; reviews: typeof qReviews }
      >();
      const group = (id: string, fullName: string, provider: string) => {
        let g = groups.get(id);
        if (!g) {
          g = { fullName, provider, prs: [], reviews: [] };
          groups.set(id, g);
        }
        return g;
      };
      for (const p of qMerged) {
        group(p.repositoryId, p.repository.fullName, p.repository.integration.provider).prs.push(p);
      }
      for (const r of qReviews) {
        const repo = r.pullRequest.repository;
        group(r.pullRequest.repositoryId, repo.fullName, repo.integration.provider).reviews.push(r);
      }

      const repos: RepoGroup[] = [...groups.entries()].map(([repositoryId, g]) => {
        const items: RepoGroup['items'] = g.prs.slice(0, CAREER_ITEMS_PER_REPO).map((p) => ({
          type: 'pr_merged' as const,
          id: p.id,
          ref: prRef(g.fullName, p.number, g.provider),
          title: p.title,
          date: localDateOf(p.mergedAt, timezone),
          url: safeUrl(p.url),
          tags: p.labels.slice(0, 3),
        }));
        const reviewedPrs = new Set(g.reviews.map((r) => r.pullRequestId)).size;
        const latest = g.reviews[0];
        if (latest) {
          items.push({
            type: 'review_cluster',
            id: latest.id,
            ref: reviewRef(g.fullName, latest.pullRequest.number, g.provider),
            title: `Reviewed ${reviewedPrs} pull request${reviewedPrs === 1 ? '' : 's'} by teammates`,
            date: localDateOf(latest.submittedAt, timezone),
            url: null,
            tags: [],
            count: reviewedPrs,
          });
        }
        return {
          repositoryId,
          fullName: g.fullName,
          items,
          truncated: g.prs.length > CAREER_ITEMS_PER_REPO,
          totalItems: g.prs.length + (latest ? 1 : 0),
        };
      });
      repos.sort((a, b) => b.totalItems - a.totalItems || a.fullName.localeCompare(b.fullName));

      const milestones: Quarter['milestones'] = [];
      for (const p of [...qMerged].reverse()) {
        if (firstMergeAt.get(p.repositoryId) === p.mergedAt.getTime()) {
          milestones.push({
            kind: 'first_merged_pr_in_repo',
            date: localDateOf(p.mergedAt, timezone),
            title: `First merged PR in ${p.repository.fullName}`,
            refs: [prRef(p.repository.fullName, p.number, p.repository.integration.provider)],
          });
        }
      }
      let largest: (typeof qMerged)[number] | null = null;
      for (const p of qMerged) {
        if (p.size !== null && (largest === null || p.size > (largest.size ?? -1))) {
          largest = p;
        }
      }
      if (largest) {
        milestones.push({
          kind: 'largest_merged_pr',
          date: localDateOf(largest.mergedAt, timezone),
          title: `Largest merged PR: ${largest.title}`,
          refs: [
            prRef(largest.repository.fullName, largest.number, largest.repository.integration.provider),
          ],
        });
      }
      const streak = computeMetric('longest_active_week_streak', facts, {
        ...range,
        startDate: qStart,
        endDate: displayEnd,
        timezone,
        periodDays: 92,
      });
      if ((streak.value ?? 0) >= 2) {
        milestones.push({
          kind: 'longest_active_week_streak',
          date: qStart,
          title: `Longest active-week streak: ${streak.value} weeks`,
          refs: [],
        });
      }
      // Achievement milestones: the two most recent achievements of the quarter.
      for (const a of qAchievements.slice(0, 2)) {
        milestones.push({ kind: 'achievement', date: a.date, title: a.title, refs: [a.ref] });
      }
      milestones.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      quarters.push({
        quarter: q,
        label: `Q${q} ${year}`,
        inProgress,
        repos,
        milestones,
        achievements: qAchievements,
        issues: qIssues.slice(0, 20).map((i) => ({
          type: 'issue_completed' as const,
          id: i.id,
          ref: issueRef(i.integration.provider, i.key),
          title: i.title,
          date: localDateOf(i.completedAt ?? start, timezone),
          url: safeUrl(i.url),
          tags: [i.key, ...(i.projectName ? [i.projectName] : [])].slice(0, 3),
        })),
        totals: {
          prsMerged: qMerged.length,
          prsReviewed: new Set(qReviews.map((r) => r.pullRequestId)).size,
          achievements: qAchievements.length,
          issuesCompleted: qIssues.length,
          storyPoints:
            Math.round(qIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0) * 100) / 100,
        },
      });
    }
    return { years: years.map((r) => r.y), year, timezone, quarters };
  }
}
