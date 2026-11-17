/**
 * Deterministic demo data: `npx prisma db seed` (or `npm run db:seed` from the repo root).
 *
 * Creates `demo@devimpact.dev` with ~9 months of activity ending today, plus a teammate whose
 * pull requests the demo user reviews (so reviewed PRs are never stored as the demo user's own,
 * see DATA-01). A fixed RNG seed makes every run produce the same pattern relative to the run
 * date. Re-running replaces the demo data; nothing else in the database is touched.
 *
 * No GitHub or Anthropic access is needed. Seeded integrations carry no tokens. Sign in as the demo
 * user with the web dev login (`ENABLE_DEV_LOGIN=true`, development only).
 *
 * P07: the data exercises every metric of KPI_METHODOLOGY §3 including edge cases — draft PRs
 * (`readyForReviewAt`), a reverted PR, PRs without a reported size, drive-by reviews (no review
 * request), several reviews on one PR, merge commits, an excluded repository and a v0.1 legacy
 * stub (both must never count) — and the daily `MetricSnapshot` rows are computed by the real
 * rollup service. Impact scores are not seeded: `GET /impact` computes them deterministically.
 * The user's time zone is Europe/London (DST transitions inside the data).
 */
import {
  DocumentType,
  IssuePriority,
  IssueStatus,
  Plan,
  PRState,
  PrismaClient,
  Provider,
  type Prisma,
} from '@prisma/client';

import { loadEnvFiles } from '../src/config/load-env';
import { scheduleSlotFor } from '../src/integrations/integration.mapper';
import { MetricsRepository } from '../src/metrics/metrics.repository';
import { RollupService } from '../src/metrics/rollup.service';
import { createPrismaClient } from '../src/prisma/create-client';

import type { PrismaService } from '../src/prisma/prisma.service';

loadEnvFiles();

export const DEMO_EMAIL = 'demo@devimpact.dev';
export const TEAMMATE_EMAIL = 'teammate@devimpact.dev';
const RNG_SEED = 20261109;
const DAYS = 270;
const DAY_MS = 86_400_000;

/** mulberry32: tiny, fast, deterministic PRNG. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick() from empty list');
      return item;
    },
    weighted: <T>(items: readonly (readonly [T, number])[]): T => {
      const total = items.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [item, weight] of items) {
        roll -= weight;
        if (roll <= 0) return item;
      }
      const last = items[items.length - 1];
      if (!last) throw new Error('weighted() from empty list');
      return last[0];
    },
    hex: (length: number) =>
      Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join(''),
  };
}

const REPOS = [
  ['acme/payments-api', 5],
  ['acme/web-app', 4],
  ['acme/infra', 2],
  ['acme/design-system', 1.5],
  ['oss/fast-json', 0.7],
] as const;

/** Excluded repository: activity here must never appear in metrics, feeds or the timeline. */
const EXCLUDED_REPO = 'acme/legacy-monolith';

const COMMIT_TEMPLATES: Record<string, readonly string[]> = {
  feat: [
    'add idempotency keys to payment intents',
    'support partial refunds',
    'add invoice PDF download',
    'introduce feature flag for new checkout',
    'add webhook retry with exponential backoff',
    'add dark mode tokens',
    'add usage-based billing meter',
    'expose subscription status endpoint',
  ],
  fix: [
    'handle null customer address',
    'prevent double submit on checkout button',
    'correct timezone offset in monthly report',
    'retry on transient database deadlock',
    'escape user input in search query',
    'fix race in session refresh',
  ],
  refactor: [
    'extract pricing rules into domain service',
    'split payments controller',
    'replace hand-rolled cache with LRU',
    'move env parsing into config module',
  ],
  perf: [
    'add composite index for invoice lookups',
    'batch ledger writes',
    'memoize expensive selector',
    'stream CSV export instead of buffering',
  ],
  test: ['add contract tests for refunds API', 'cover webhook signature edge cases'],
  docs: ['document local setup', 'add ADR for event sourcing'],
  chore: ['bump dependencies', 'tighten eslint rules', 'update CI cache key'],
};

const COMMIT_TYPES = [
  ['feat', 30],
  ['fix', 22],
  ['refactor', 14],
  ['perf', 8],
  ['test', 10],
  ['docs', 6],
  ['chore', 10],
] as const;

const PR_TITLES = [
  'Payments: idempotent intent creation',
  'Checkout v2 behind feature flag',
  'Refunds API (partial + full)',
  'Ledger write batching',
  'Webhook delivery retries',
  'Invoice PDF export',
  'Design tokens: dark mode',
  'Terraform: split staging and prod state',
  'Observability: request tracing',
  'Search: escape user input',
  'Usage-based billing meter',
  'Session refresh race fix',
  'Monthly report timezone fix',
  'CSV export streaming',
];

const TEAMMATE_PR_TITLES = [
  'Add OpenTelemetry exporter',
  'Migrate cron jobs to queues',
  'Customer portal: billing history',
  'Rate limit public endpoints',
  'Upgrade Postgres driver',
  'Accessibility fixes for forms',
  'Refactor auth middleware',
  'Add tax calculation service',
];

/** Days (counted back from today) with no activity: vacations and a sick week. */
function isGap(daysAgo: number) {
  return (
    (daysAgo >= 118 && daysAgo <= 133) ||
    (daysAgo >= 40 && daysAgo <= 44) ||
    (daysAgo >= 200 && daysAgo <= 206)
  );
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function seed(prisma: PrismaClient, today: Date = new Date()) {
  const rng = createRng(RNG_SEED);
  const anchor = startOfUtcDay(today);
  const at = (daysAgo: number, hour: number, minute = 0) =>
    new Date(anchor.getTime() - daysAgo * DAY_MS + (hour * 60 + minute) * 60_000);

  // Idempotent: remove previous demo data (cascades to all related rows).
  await prisma.user.deleteMany({ where: { email: { in: [DEMO_EMAIL, TEAMMATE_EMAIL] } } });

  const demo = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      emailVerified: true,
      name: 'Dana Demo',
      plan: Plan.PRO,
      settings: { create: { timezone: 'Europe/London', onboardingCompletedAt: anchor } },
    },
  });
  const teammate = await prisma.user.create({
    data: {
      email: TEAMMATE_EMAIL,
      emailVerified: true,
      name: 'Taylor Teammate',
      plan: Plan.FREE,
      settings: { create: { timezone: 'UTC' } },
    },
  });

  const demoGh = await prisma.integration.create({
    data: {
      userId: demo.id,
      provider: Provider.GITHUB,
      // No token: the seeded integration is display-only (sync needs a real GitHub App connect).
      externalAccountId: 'seed:dana-demo',
      externalLogin: 'dana-demo',
      displayName: 'Dana Demo',
      lastSyncedAt: anchor,
      lastSuccessfulSyncAt: anchor,
    },
  });
  const teammateGh = await prisma.integration.create({
    data: {
      userId: teammate.id,
      provider: Provider.GITHUB,
      externalAccountId: 'seed:taylor-teammate',
      externalLogin: 'taylor-teammate',
      displayName: 'Taylor Teammate',
    },
  });

  // Repositories (DATA_MODEL_V2: activity rows reference a Repository of the same user).
  const repoRow = (userId: string, integrationId: string, fullName: string) => {
    const [ownerLogin = fullName, name = fullName] = fullName.split('/');
    return {
      userId,
      integrationId,
      externalId: `seed:${userId}:${fullName}`,
      fullName,
      ownerLogin,
      name,
      isPrivate: ownerLogin === 'acme',
      defaultBranch: 'main',
      htmlUrl: `https://github.com/${fullName}`,
      included: true,
      lastSyncedAt: anchor,
      commitCursor: anchor,
    };
  };
  await prisma.repository.createMany({
    data: [
      ...REPOS.map(([fullName]) => repoRow(demo.id, demoGh.id, fullName)),
      // Excluded by the user (F-11): its activity is stored but never counted.
      { ...repoRow(demo.id, demoGh.id, EXCLUDED_REPO), included: false, inclusionSource: 'USER' },
      ...REPOS.map(([fullName]) => repoRow(teammate.id, teammateGh.id, fullName)),
    ],
  });
  const repoIds = new Map(
    (await prisma.repository.findMany({ select: { id: true, userId: true, fullName: true } })).map(
      (r) => [`${r.userId}:${r.fullName}`, r.id],
    ),
  );
  const repoId = (userId: string, fullName: string) => {
    const id = repoIds.get(`${userId}:${fullName}`);
    if (!id) throw new Error(`seed: unknown repository ${fullName}`);
    return id;
  };

  const commits: Prisma.CommitCreateManyInput[] = [];
  const prs: Prisma.PullRequestCreateManyInput[] = [];
  const issues: Prisma.IssueCreateManyInput[] = [];
  const prNumbers = new Map<string, number>(REPOS.map(([repo]) => [repo, rng.int(40, 400)]));
  const nextPrNumber = (repo: string) => {
    const n = (prNumbers.get(repo) ?? 1) + 1;
    prNumbers.set(repo, n);
    return n;
  };

  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const day = at(daysAgo, 0);
    const weekday = day.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    // Always show activity in the last few days so "this month" is never empty.
    const forcedActive = daysAgo <= 2;
    if (!forcedActive && (isGap(daysAgo) || !rng.chance(isWeekend ? 0.12 : 0.78))) continue;

    // Busy weeks around "launches" produce visible streaks.
    const burst = daysAgo % 63 < 7 ? 3 : 0;
    const commitCount = rng.int(1, 4) + burst;
    const repo = rng.weighted(REPOS);
    for (let i = 0; i < commitCount; i++) {
      const type = rng.weighted(COMMIT_TYPES);
      const subject = rng.pick(COMMIT_TEMPLATES[type] ?? ['update']);
      const size = rng.weighted([
        ['s', 6],
        ['m', 3],
        ['l', 1],
      ] as const);
      const additions =
        size === 's' ? rng.int(1, 40) : size === 'm' ? rng.int(40, 250) : rng.int(250, 900);
      const authoredAt = at(daysAgo, rng.int(9, 18), rng.int(0, 59));
      commits.push({
        userId: demo.id,
        integrationId: demoGh.id,
        repositoryId: repoId(demo.id, rng.chance(0.85) ? repo : rng.weighted(REPOS)),
        sha: rng.hex(40),
        messageHeadline: `${type}: ${subject}`,
        branch: 'main',
        additions,
        deletions: Math.round(additions * rng.next() * 0.6),
        changedFiles: rng.int(1, 12),
        authoredAt,
        committedAt: authoredAt,
        authorExternalId: 'seed:dana-demo',
      });
    }
    // Merge commits (2 parents) are stored but never counted (KPI §2.2 `CM`).
    if (rng.chance(0.15)) {
      const authoredAt = at(daysAgo, 17, rng.int(0, 59));
      commits.push({
        userId: demo.id,
        integrationId: demoGh.id,
        repositoryId: repoId(demo.id, repo),
        sha: rng.hex(40),
        messageHeadline: `Merge branch 'main' into feature`,
        branch: 'main',
        additions: 0,
        deletions: 0,
        parentsCount: 2,
        authoredAt,
        committedAt: authoredAt,
        authorExternalId: 'seed:dana-demo',
      });
    }
    // Work in the excluded repository (never counted).
    if (rng.chance(0.1)) {
      const authoredAt = at(daysAgo, 12, rng.int(0, 59));
      commits.push({
        userId: demo.id,
        integrationId: demoGh.id,
        repositoryId: repoId(demo.id, EXCLUDED_REPO),
        sha: rng.hex(40),
        messageHeadline: 'chore: legacy monolith upkeep',
        branch: 'main',
        additions: rng.int(1, 30),
        deletions: rng.int(0, 10),
        authoredAt,
        committedAt: authoredAt,
        authorExternalId: 'seed:dana-demo',
      });
    }

    // Authored PRs: roughly every other active day.
    if (rng.chance(0.45)) {
      const ageInDays = daysAgo;
      const state =
        ageInDays < 3 && rng.chance(0.6)
          ? PRState.OPEN
          : rng.weighted([
              [PRState.MERGED, 88],
              [PRState.CLOSED, 12],
            ] as const);
      const createdAt = at(daysAgo, rng.int(10, 17));
      // ~25 % start as drafts: cycle time counts from "ready for review" (KPI §2.3).
      const readyForReviewAt = rng.chance(0.25)
        ? new Date(createdAt.getTime() + rng.int(2, 30) * 3_600_000)
        : null;
      const readyAt = readyForReviewAt ?? createdAt;
      const mergedAt =
        state === PRState.MERGED ? new Date(readyAt.getTime() + rng.int(2, 72) * 3_600_000) : null;
      const closedAt =
        state === PRState.OPEN
          ? null
          : (mergedAt ?? new Date(createdAt.getTime() + rng.int(4, 96) * 3_600_000));
      // Sizes: mostly small, some large; ~3 % without a reported size (legacy rows).
      const unknownSize = rng.chance(0.03);
      const additions = rng.weighted([
        [rng.int(5, 200), 7],
        [rng.int(200, 900), 3],
      ] as const);
      const reviewers = rng.int(1, 3);
      const number = nextPrNumber(repo);
      // ~5 % of merged PRs are later reverted (GitHub "Revert" PR referencing this one).
      const revertedAt =
        mergedAt && rng.chance(0.05) ? new Date(mergedAt.getTime() + rng.int(1, 4) * DAY_MS) : null;
      prs.push({
        userId: demo.id,
        integrationId: demoGh.id,
        repositoryId: repoId(demo.id, repo),
        externalId: `seed:pr:${repo}#${number}`,
        number,
        title: rng.pick(PR_TITLES),
        body: 'Seeded demo pull request.',
        url: `https://github.com/${repo}/pull/${number}`,
        state,
        isAuthoredByUser: true,
        authorLogin: 'dana-demo',
        authorExternalId: 'seed:dana-demo',
        baseRef: 'main',
        createdAtRemote: createdAt,
        readyForReviewAt,
        updatedAtRemote: closedAt ?? createdAt,
        mergedAt,
        closedAt,
        additions: unknownSize ? null : additions,
        deletions: unknownSize ? null : Math.round(additions * rng.next() * 0.5),
        changedFiles: unknownSize ? null : rng.int(1, 20),
        commitsCount: rng.int(1, 8),
        revertedAt,
        revertedByUrl: revertedAt ? `https://github.com/${repo}/pull/${number + 1000}` : null,
        firstReviewAt: new Date(readyAt.getTime() + rng.int(1, 30) * 3_600_000),
        reviewersCount: reviewers,
        approvalsCount: state === PRState.MERGED ? Math.min(reviewers, rng.int(1, 2)) : 0,
        changesRequestedCount: rng.chance(0.2) ? 1 : 0,
      });
    }

    // Tracked issues (Jira/Linear-style) every few days.
    if (rng.chance(0.2)) {
      issues.push({
        userId: demo.id,
        integrationId: demoGh.id,
        title: `${rng.pick(['Investigate', 'Implement', 'Fix', 'Document'])} ${rng.pick(COMMIT_TEMPLATES.feat ?? ['task'])}`,
        labels: [rng.pick(['backend', 'frontend', 'infra']), rng.pick(['p1', 'p2', 'p3'])],
        storyPoints: rng.pick([1, 2, 3, 5, 8]),
        priority: rng.pick([IssuePriority.HIGH, IssuePriority.MEDIUM, IssuePriority.LOW]),
        status: daysAgo < 10 ? IssueStatus.IN_PROGRESS : IssueStatus.DONE,
        projectName: 'Payments Platform',
        timestamp: at(daysAgo, 11),
      });
    }
  }

  // Teammate PRs reviewed by the demo user. The teammate owns the authored row; the demo user gets
  // a reviewed copy (isAuthoredByUser = false, no body) plus their own review — reviewed PRs are
  // never stored as the demo user's authored PRs (DATA-01, ARCHITECTURE_V2 §12).
  const reviews: Prisma.PullRequestReviewCreateManyInput[] = [];
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo -= rng.int(2, 5)) {
    if (isGap(daysAgo)) continue;
    const repo = rng.weighted(REPOS);
    const createdAt = at(daysAgo, rng.int(9, 16));
    const mergedAt = new Date(createdAt.getTime() + rng.int(4, 48) * 3_600_000);
    const number = nextPrNumber(repo);
    const title = rng.pick(TEAMMATE_PR_TITLES);
    const shared = {
      number,
      title,
      url: `https://github.com/${repo}/pull/${number}`,
      state: PRState.MERGED,
      authorLogin: 'taylor-teammate',
      authorExternalId: 'seed:taylor-teammate',
      baseRef: 'main',
      createdAtRemote: createdAt,
      updatedAtRemote: mergedAt,
      mergedAt,
      closedAt: mergedAt,
    };
    prs.push({
      userId: teammate.id,
      integrationId: teammateGh.id,
      repositoryId: repoId(teammate.id, repo),
      externalId: `seed:pr:${repo}#${number}`,
      isAuthoredByUser: true,
      ...shared,
    });
    prs.push({
      userId: demo.id,
      integrationId: demoGh.id,
      repositoryId: repoId(demo.id, repo),
      externalId: `seed:pr:${repo}#${number}`,
      isAuthoredByUser: false,
      ...shared,
    });
    const changesRequested = rng.chance(0.25);
    const submittedAt = new Date(createdAt.getTime() + rng.int(1, 20) * 3_600_000);
    reviews.push({
      userId: demo.id,
      integrationId: demoGh.id,
      pullRequestId: `pending:${repo}#${number}`,
      externalId: `seed:review:${repo}#${number}`,
      state: changesRequested ? 'CHANGES_REQUESTED' : 'APPROVED',
      submittedAt,
      hasBody: changesRequested || rng.chance(0.4),
      commentsCount: rng.int(changesRequested ? 2 : 0, changesRequested ? 9 : 3),
      // ~20 % are drive-by reviews without a request (excluded from review turnaround).
      reviewRequestedAt: rng.chance(0.2) ? null : new Date(createdAt.getTime() + 30 * 60_000),
    });
    // Follow-up replies are separate COMMENTED reviews on the same PR (counted once per PR).
    if (rng.chance(0.3)) {
      reviews.push({
        userId: demo.id,
        integrationId: demoGh.id,
        pullRequestId: `pending:${repo}#${number}`,
        externalId: `seed:review:${repo}#${number}:reply`,
        state: 'COMMENTED',
        submittedAt: new Date(submittedAt.getTime() + rng.int(1, 6) * 3_600_000),
        hasBody: true,
        commentsCount: rng.int(0, 2),
      });
    }
  }

  // An excluded-repo PR and a v0.1 legacy stub ("PR #n", reviewed only): never counted.
  prs.push(
    {
      userId: demo.id,
      integrationId: demoGh.id,
      repositoryId: repoId(demo.id, EXCLUDED_REPO),
      externalId: `seed:pr:${EXCLUDED_REPO}#7`,
      number: 7,
      title: 'Legacy monolith: bump runtime',
      url: `https://github.com/${EXCLUDED_REPO}/pull/7`,
      state: PRState.MERGED,
      isAuthoredByUser: true,
      authorLogin: 'dana-demo',
      createdAtRemote: at(5, 10),
      mergedAt: at(4, 10),
      closedAt: at(4, 10),
      additions: 12,
      deletions: 3,
    },
    {
      userId: demo.id,
      integrationId: demoGh.id,
      repositoryId: repoId(demo.id, 'acme/payments-api'),
      number: 9001,
      title: 'PR #9001',
      state: PRState.CLOSED,
      isAuthoredByUser: false,
      legacyStub: true,
      createdAtRemote: at(20, 10),
      closedAt: at(20, 10),
    },
  );

  await prisma.commit.createMany({ data: commits });
  await prisma.pullRequest.createMany({ data: prs });
  await prisma.issue.createMany({ data: issues });
  const reviewedIds = new Map(
    (
      await prisma.pullRequest.findMany({
        where: { userId: demo.id, isAuthoredByUser: false },
        select: { id: true, number: true, repository: { select: { fullName: true } } },
      })
    ).map((p) => [`pending:${p.repository.fullName}#${p.number}`, p.id]),
  );
  await prisma.pullRequestReview.createMany({
    data: reviews.map((r) => ({ ...r, pullRequestId: reviewedIds.get(r.pullRequestId) ?? '' })),
  });
  const reviewCount = reviews.length;
  const authoredCount = prs.filter(
    (p) =>
      p.userId === demo.id &&
      p.isAuthoredByUser &&
      p.repositoryId !== repoId(demo.id, EXCLUDED_REPO),
  ).length;

  // One finished backfill so sync status/history render without GitHub.
  await prisma.integration.update({
    where: { id: teammateGh.id },
    data: { scheduleSlotMinute: scheduleSlotFor(teammateGh.id) },
  });
  await prisma.integration.update({
    where: { id: demoGh.id },
    data: {
      scheduleSlotMinute: scheduleSlotFor(demoGh.id),
      backfillFrom: at(DAYS, 0),
      syncCursor: {
        authoredPrsUpdatedAt: anchor.toISOString(),
        reviewedPrsUpdatedAt: anchor.toISOString(),
      },
    },
  });
  await prisma.syncRun.create({
    data: {
      userId: demo.id,
      integrationId: demoGh.id,
      trigger: 'INITIAL',
      kind: 'BACKFILL',
      status: 'SUCCEEDED',
      stage: 'DONE',
      progress: 100,
      windowFrom: at(DAYS, 0),
      windowTo: anchor,
      counts: {
        repos: REPOS.length,
        prsAuthored: authoredCount,
        prsReviewed: reviewCount,
        reviews: reviewCount,
        commits: commits.length,
      },
      queuedAt: anchor,
      startedAt: anchor,
      finishedAt: anchor,
      recentWindowCompletedAt: anchor,
    },
  });

  // Daily snapshots via the real rollup service (KPI §4); impact scores are computed lazily.
  const rollups = new RollupService(new MetricsRepository(prisma as PrismaService));
  const snapshot = await rollups.recompute(demo.id, at(DAYS + 7, 0), today, today);

  const sixMonthsAgo = new Date(anchor.getTime() - 182 * DAY_MS).toISOString();
  const now = anchor.toISOString();
  await prisma.generatedDocument.createMany({
    data: [
      {
        userId: demo.id,
        type: DocumentType.RESUME,
        dateRange: { from: sixMonthsAgo, to: now },
        content: {
          bullets: [
            {
              text: 'Led the redesign of payment intent creation with idempotency keys, eliminating duplicate charges across 3 client apps',
              category: 'reliability',
              impact: 'Zero duplicate-charge incidents since launch',
            },
            {
              text: 'Shipped partial refunds and invoice PDF export end-to-end across API and web',
              category: 'features',
              impact: 'Closed the top two support-ticket drivers',
            },
            {
              text: 'Batched ledger writes and added composite indexes, cutting p95 invoice lookup latency by ~40%',
              category: 'performance',
              impact: 'Faster month-end reporting',
            },
            {
              text: 'Reviewed teammates’ pull requests weekly, focusing on API design and test coverage',
              category: 'collaboration',
              impact: 'Consistent review turnaround under one day',
            },
          ],
        },
      },
      {
        userId: demo.id,
        type: DocumentType.APPRAISAL,
        dateRange: { from: sixMonthsAgo, to: now },
        content: {
          executiveSummary:
            'Dana delivered the payments reliability roadmap and became the go-to reviewer for API changes.',
          keyContributions: [
            { title: 'Idempotent payments', evidence: 'Payments: idempotent intent creation' },
            { title: 'Refunds API', evidence: 'Refunds API (partial + full)' },
          ],
          metrics: {
            prCount: authoredCount,
            reviewCount,
            featuresShipped: 6,
            commitsCount: commits.length,
          },
          areasOfImpact: ['Reliability', 'Developer experience'],
          growthAndLearning: ['Led first incident review'],
          goalsForNextPeriod: ['Own the billing platform roadmap'],
        },
      },
      {
        userId: demo.id,
        type: DocumentType.PROMOTION,
        dateRange: { from: sixMonthsAgo, to: now },
        content: {
          whyReady:
            'Consistently operates at senior scope: drives cross-team projects and raises the review bar.',
          leadershipEvidence: ['Led checkout v2 rollout across two teams'],
          technicalImpact: ['Ledger write batching', 'Idempotent payment intents'],
          businessValue: ['Reduced refund-related support load'],
          mentorship: ['Onboarded two engineers to the payments codebase'],
          supportingData: { commits: commits.length, prs: authoredCount, reviews: reviewCount },
        },
      },
    ],
  });

  return {
    user: demo.email,
    userId: demo.id,
    commits: commits.length,
    pullRequests: authoredCount,
    reviews: reviewCount,
    issues: issues.length,
    snapshots: snapshot.snapshots,
    documents: 3,
  };
}

async function main() {
  const prisma = createPrismaClient();
  try {
    const summary = await seed(prisma);
    console.log('Seeded demo data:', summary);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
