/**
 * P12 seed: achievements (several categories, some linked to the demo user's own PRs / reviews /
 * commits, one in each recent quarter), goals (a metric target that is met, one that is not, one
 * tracked by achievements), digest settings and a delivered digest row — so every designed state
 * of S17/S18/S21 exists without AI. Goal targets are derived from the engine's own values for the
 * evaluated month, so "On target" / "Not yet" hold whatever day the seed runs.
 */
import {
  addDays,
  periodSpecContaining,
  resolvePeriod,
  shiftPeriodSpec,
  startOfIsoWeek,
  todayIn,
  type ImplementedMetricKey,
} from '@devimpact/shared';
import {
  AchievementCategory,
  AchievementSource,
  EvidenceKind,
  GoalComparator,
  type PrismaClient,
} from '@prisma/client';

import { ImpactScoreService } from '../src/metrics/impact-score.service';
import { MetricsRepository } from '../src/metrics/metrics.repository';

import type { PrismaService } from '../src/prisma/prisma.service';

export const THROWAWAY_EMAIL = 'delete-me@devimpact.dev';

const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Achievements first (before the snapshot rollup, so the `achievements` counter is filled). */
export async function seedAchievements(prisma: PrismaClient, userId: string, anchor: Date) {
  const timezone = 'Europe/London';
  const today = todayIn(timezone, anchor);
  const merged = await prisma.pullRequest.findMany({
    where: {
      userId,
      isAuthoredByUser: true,
      legacyStub: false,
      mergedAt: { not: null },
      repository: { included: true },
    },
    select: { id: true, title: true, mergedAt: true, additions: true, deletions: true },
    orderBy: [{ mergedAt: 'desc' }, { id: 'asc' }],
  });
  const review = await prisma.pullRequestReview.findFirst({
    where: { userId, pullRequest: { repository: { included: true } } },
    orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  const commit = await prisma.commit.findFirst({
    where: { userId, parentsCount: 1, repository: { included: true } },
    orderBy: [{ authoredAt: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });
  const largestBetween = (fromDaysAgo: number, toDaysAgo: number) => {
    const lo = addDays(today, -toDaysAgo);
    const hi = addDays(today, -fromDaysAgo);
    return [...merged]
      .filter((p) => {
        const d = p.mergedAt?.toISOString().slice(0, 10) ?? '';
        return d >= lo && d <= hi;
      })
      .sort(
        (a, b) =>
          (b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0)) ||
          (a.id < b.id ? -1 : 1),
      )[0];
  };
  const recentPr = largestBetween(10, 30);
  const incidentPr = largestBetween(60, 90);

  const items: {
    daysAgo: number;
    title: string;
    category: AchievementCategory;
    impact: string | null;
    description: string | null;
    links?: { url: string; label: string }[];
    source?: AchievementSource;
    evidence: { kind: EvidenceKind; id: string | undefined }[];
  }[] = [
    {
      daysAgo: 12,
      title: recentPr
        ? `Shipped ${recentPr.title.toLowerCase()}`
        : 'Shipped idempotent payment intents',
      category: AchievementCategory.DELIVERY,
      impact: 'Duplicate charges on client retries dropped to zero after rollout.',
      description: 'Staged behind a flag, rolled out to 100% over a week with no incidents.',
      source: AchievementSource.FROM_ACTIVITY,
      evidence: [{ kind: EvidenceKind.PULL_REQUEST, id: recentPr?.id }],
    },
    {
      daysAgo: 40,
      title: 'Mentored two new engineers through their first on-call rotation',
      category: AchievementCategory.MENTORING,
      impact: 'Both now handle payments alerts on their own.',
      description: 'Weekly pairing sessions and a written runbook walkthrough.',
      evidence: [],
    },
    {
      daysAgo: 75,
      title: 'Led the checkout outage incident response',
      category: AchievementCategory.INCIDENT,
      impact: 'Restored checkout in 38 minutes; follow-ups closed within two weeks.',
      description: 'Incident commander for a Saturday outage caused by a webhook retry storm.',
      links: [{ url: 'https://example.com/postmortems/checkout-outage', label: 'Postmortem' }],
      evidence: [
        { kind: EvidenceKind.PULL_REQUEST, id: incidentPr?.id },
        { kind: EvidenceKind.COMMIT, id: commit?.id },
      ],
    },
    {
      daysAgo: 120,
      title: 'Wrote the ledger batching design doc',
      category: AchievementCategory.LEADERSHIP,
      impact: 'Adopted by two teams as the template for write-path changes.',
      description: null,
      links: [{ url: 'https://example.com/docs/ledger-batching', label: 'Design doc' }],
      evidence: [],
    },
    {
      daysAgo: 170,
      title: 'Completed the distributed systems reading group',
      category: AchievementCategory.LEARNING,
      impact: null,
      description: 'Twelve sessions; presented the Raft paper.',
      evidence: [],
    },
    {
      daysAgo: 230,
      title: 'Unblocked the UI kit dark theme release with fast reviews',
      category: AchievementCategory.COLLABORATION,
      impact: 'Reviewed the contrast fixes within a day so the release shipped on time.',
      description: null,
      evidence: [{ kind: EvidenceKind.REVIEW, id: review?.id }],
    },
  ];

  const ids: string[] = [];
  for (const [i, a] of items.entries()) {
    const occurredOn = addDays(today, -a.daysAgo);
    const created = new Date(`${occurredOn}T17:00:00.000Z`);
    const row = await prisma.achievement.create({
      data: {
        userId,
        title: a.title.slice(0, 200),
        category: a.category,
        impact: a.impact,
        description: a.description,
        occurredOn: dbDate(occurredOn),
        links: a.links ?? [],
        source: a.source ?? AchievementSource.MANUAL,
        createdAt: created,
        updatedAt: created,
        evidence: {
          create: a.evidence.flatMap((e) =>
            e.id
              ? [
                  e.kind === EvidenceKind.PULL_REQUEST
                    ? { kind: e.kind, pullRequestId: e.id }
                    : e.kind === EvidenceKind.COMMIT
                      ? { kind: e.kind, commitId: e.id }
                      : { kind: e.kind, reviewId: e.id },
                ]
              : [],
          ),
        },
      },
      select: { id: true },
    });
    ids[i] = row.id;
  }
  return ids;
}

/** Goals + digest rows (after snapshots exist, so goal targets can be derived from the engine). */
export async function seedGoalsAndDigests(
  prisma: PrismaClient,
  userId: string,
  anchor: Date,
  achievementIds: string[],
) {
  const timezone = 'Europe/London';
  const today = todayIn(timezone, anchor);
  const evalSpec = shiftPeriodSpec(periodSpecContaining('month', today), -1);
  const period = resolvePeriod(evalSpec, timezone, today);
  const scores = new ImpactScoreService(new MetricsRepository(prisma as unknown as PrismaService));
  const { inputs } = await scores.scoreFor(userId, period);
  const valueOf = (key: ImplementedMetricKey) =>
    inputs.metrics[key].status === 'ok' ? inputs.metrics[key].value : null;

  // On target: a "lower is better" metric with the target comfortably above the current value.
  const lteKey = (
    [
      'review_turnaround_median_hours',
      'pr_cycle_time_median_hours',
      'time_to_first_review_median_hours',
    ] as const
  ).find((k) => valueOf(k) !== null);
  const lteValue = lteKey ? (valueOf(lteKey) ?? 0) : 0;
  const merged = valueOf('prs_merged') ?? inputs.metrics.prs_merged.value ?? 0;
  const halfStart = `${today.slice(0, 4)}-${Number(today.slice(5, 7)) <= 6 ? '01' : '07'}-01`;
  const halfEnd = `${today.slice(0, 4)}-${Number(today.slice(5, 7)) <= 6 ? '06-30' : '12-31'}`;

  const goals = [
    {
      title: "Review teammates' PRs within a day",
      description: 'Keep the review queue short so nobody waits overnight.',
      metricKey: lteKey ?? 'review_turnaround_median_hours',
      comparator: GoalComparator.LTE,
      targetValue: Math.max(8, Math.ceil(lteValue * 1.5)),
    },
    {
      title: 'Merge more small, focused PRs',
      description: 'Split work into reviewable changes.',
      metricKey: 'prs_merged',
      comparator: GoalComparator.GTE,
      targetValue: merged + 6,
    },
    {
      title: 'Grow as a mentor on the payments team',
      description: 'Tracked through mentoring and leadership achievements.',
      metricKey: null,
      comparator: null,
      targetValue: null,
    },
  ];
  for (const [i, g] of goals.entries()) {
    await prisma.goal.create({
      data: {
        userId,
        title: g.title,
        description: g.description,
        startDate: dbDate(halfStart),
        targetDate: dbDate(halfEnd),
        metricKey: g.metricKey,
        comparator: g.comparator,
        targetValue: g.targetValue,
        createdAt: new Date(anchor.getTime() - (30 - i) * 86_400_000),
        achievements:
          g.metricKey === null
            ? {
                create: [achievementIds[1], achievementIds[3]]
                  .filter(Boolean)
                  .map((achievementId) => ({ achievementId: achievementId })),
              }
            : undefined,
      },
    });
  }

  await prisma.userSettings.update({
    where: { userId },
    data: { digestEnabled: true, digestDayOfWeek: 1, digestHourLocal: 9 },
  });
  const lastWeek = addDays(startOfIsoWeek(today), -7);
  // The week before last was delivered (last week's digest is still due, so a local worker sends it).
  await prisma.digestDelivery.create({
    data: {
      userId,
      weekStart: dbDate(addDays(lastWeek, -7)),
      status: 'SENT',
      sentAt: new Date(`${lastWeek}T09:00:12.000Z`),
    },
  });
  return goals.length;
}

/** A disposable FREE user for the account-deletion E2E (never the demo user). */
export async function seedThrowawayUser(prisma: PrismaClient, anchor: Date) {
  await prisma.user.deleteMany({ where: { email: THROWAWAY_EMAIL } });
  const today = anchor.toISOString().slice(0, 10);
  return prisma.user.create({
    data: {
      email: THROWAWAY_EMAIL,
      emailVerified: true,
      name: 'Dee Lete',
      settings: { create: { timezone: 'UTC', onboardingCompletedAt: anchor } },
      achievements: {
        create: {
          title: 'Ran the team offsite',
          category: AchievementCategory.LEADERSHIP,
          occurredOn: dbDate(addDays(today, -3)),
        },
      },
      goals: { create: { title: 'Ship the onboarding revamp', startDate: dbDate(today) } },
    },
    select: { id: true, email: true },
  });
}
