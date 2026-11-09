/**
 * Deterministic demo data: `npx prisma db seed` (or `npm run db:seed` from the repo root).
 *
 * Creates `demo@devimpact.dev` with ~9 months of activity ending today, plus a teammate whose
 * pull requests the demo user reviews (so reviewed PRs are never stored as the demo user's own,
 * see DATA-01). A fixed RNG seed makes every run produce the same pattern relative to the run
 * date. Re-running replaces the demo data; nothing else in the database is touched.
 *
 * No GitHub or Anthropic access is needed. The GitHub token is a placeholder.
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

loadEnvFiles();

export const DEMO_EMAIL = 'demo@devimpact.dev';
export const TEAMMATE_EMAIL = 'teammate@devimpact.dev';
const RNG_SEED = 20261109;
const DAYS = 270;
const DAY_MS = 86_400_000;

/** mulberry32: tiny, fast, deterministic PRNG. */
function createRng(seed: number) {
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
    data: { email: DEMO_EMAIL, name: 'Dana Demo', plan: Plan.PRO },
  });
  const teammate = await prisma.user.create({
    data: { email: TEAMMATE_EMAIL, name: 'Taylor Teammate', plan: Plan.FREE },
  });

  const demoGh = await prisma.integration.create({
    data: {
      userId: demo.id,
      provider: Provider.GITHUB,
      // Placeholder only — sync with it fails. Tokens get encrypted at rest in P05 (D-005).
      accessToken: 'demo-placeholder-token-not-a-real-secret',
      metadata: { username: 'dana-demo', name: 'Dana Demo', avatar: null, seeded: true },
    },
  });
  const teammateGh = await prisma.integration.create({
    data: {
      userId: teammate.id,
      provider: Provider.GITHUB,
      accessToken: 'teammate-placeholder-token-not-a-real-secret',
      metadata: { username: 'taylor-teammate', seeded: true },
    },
  });

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
      commits.push({
        userId: demo.id,
        integrationId: demoGh.id,
        sha: rng.hex(40),
        message: `${type}: ${subject}`,
        repo: rng.chance(0.85) ? repo : rng.weighted(REPOS),
        branch: 'main',
        additions,
        deletions: Math.round(additions * rng.next() * 0.6),
        timestamp: at(daysAgo, rng.int(9, 18), rng.int(0, 59)),
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
      prs.push({
        userId: demo.id,
        integrationId: demoGh.id,
        number: nextPrNumber(repo),
        title: rng.pick(PR_TITLES),
        body: 'Seeded demo pull request.',
        state,
        repo,
        mergedAt:
          state === PRState.MERGED
            ? new Date(createdAt.getTime() + rng.int(2, 72) * 3_600_000)
            : null,
        reviewCount: rng.int(1, 3),
        timestamp: createdAt,
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

  await prisma.commit.createMany({ data: commits });
  await prisma.pullRequest.createMany({ data: prs });
  await prisma.issue.createMany({ data: issues });

  // Teammate PRs reviewed by the demo user: stored under the teammate, reviews under the demo user.
  let reviewCount = 0;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo -= rng.int(2, 5)) {
    if (isGap(daysAgo)) continue;
    const repo = rng.weighted(REPOS);
    const createdAt = at(daysAgo, rng.int(9, 16));
    const pr = await prisma.pullRequest.create({
      data: {
        userId: teammate.id,
        integrationId: teammateGh.id,
        number: nextPrNumber(repo),
        title: rng.pick(TEAMMATE_PR_TITLES),
        state: PRState.MERGED,
        repo,
        mergedAt: new Date(createdAt.getTime() + rng.int(4, 48) * 3_600_000),
        reviewCount: 1,
        timestamp: createdAt,
      },
    });
    const changesRequested = rng.chance(0.25);
    await prisma.codeReview.create({
      data: {
        userId: demo.id,
        prId: pr.id,
        comments: rng.int(changesRequested ? 2 : 0, changesRequested ? 9 : 3),
        approved: !changesRequested,
        timestamp: new Date(createdAt.getTime() + rng.int(1, 20) * 3_600_000),
      },
    });
    reviewCount++;
  }

  // Monthly impact scores for the last 6 months (incl. the current one) so the dashboard never
  // has to call the AI. Placeholder numbers — the deterministic engine replaces them in P07.
  const scores: Prisma.ImpactScoreCreateManyInput[] = [];
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsAgo, 1));
    const base = rng.int(62, 84);
    scores.push({
      userId: demo.id,
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
      overall: base,
      featureDelivery: Math.min(100, base + rng.int(-6, 10)),
      codeQuality: Math.min(100, base + rng.int(-8, 8)),
      collaboration: Math.min(100, base + rng.int(-4, 12)),
      leadership: Math.min(100, base + rng.int(-12, 4)),
      highlights: ['Seeded demo score (not computed from activity)'],
    });
  }
  await prisma.impactScore.createMany({ data: scores });

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
            prCount: prs.length,
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
          supportingData: { commits: commits.length, prs: prs.length, reviews: reviewCount },
        },
      },
    ],
  });

  return {
    user: demo.email,
    userId: demo.id,
    commits: commits.length,
    pullRequests: prs.length,
    reviews: reviewCount,
    issues: issues.length,
    impactScores: scores.length,
    documents: 3,
  };
}

async function main() {
  const prisma = new PrismaClient();
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
