/**
 * AUDIT HELPER — not the real seed script (that is built in Phase 02).
 *
 * Inserts two users into the local dev database so every page and endpoint can be
 * exercised without a GitHub account:
 *   - alice@audit.local  : ~6 months of commits, authored PRs, reviews, impact scores, docs
 *   - bob@audit.local    : a second tenant with a small amount of data (used for IDOR probes)
 *
 * The data deliberately mirrors what v0.1.0's sync processor would store, INCLUDING the
 * stub "PR #n" rows the processor creates for PRs the user only reviewed (see BUG/DATA
 * findings in docs/v2/audit/ISSUES.md). Those rows are tagged in the body field so they
 * can be identified in the audit.
 *
 * Usage (Node >= 22.18 strips TS types natively):
 *   set -a; . ./.env; set +a
 *   node docs/v2/audit/scripts/seed-fixture.ts            # (re)seed
 *   node docs/v2/audit/scripts/seed-fixture.ts --wipe     # remove audit users only
 *   node docs/v2/audit/scripts/seed-fixture.ts --wipe-all # TRUNCATE every table (empty-DB tests)
 *
 * Prints the created user IDs as JSON on the last line.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Resolve @prisma/client from the monorepo root node_modules.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Deterministic PRNG (mulberry32) so screenshots are reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

const REPOS = ['acme/checkout-service', 'acme/web-app', 'acme/platform-infra', 'alice/dotfiles', 'acme/search-api'];
const VERBS = ['feat', 'fix', 'refactor', 'perf', 'chore', 'test', 'docs'];
const SUBJECTS = [
  'add retry to payment webhook handler',
  'cache product search results in redis',
  'migrate checkout form to react-hook-form',
  'reduce p95 latency of /cart endpoint',
  'fix race condition in inventory reservation',
  'add terraform module for read replicas',
  'remove dead feature flags',
  'improve error messages on login',
  'add pagination to orders API',
  'upgrade node base image',
  'instrument checkout funnel with opentelemetry',
  'split monolith billing module',
];
const PR_TITLES = [
  'Checkout: idempotent payment capture',
  'Search: Redis result cache with TTL',
  'Infra: read replica for reporting DB',
  'Web: accessible checkout form',
  'Orders API: cursor pagination',
  'Billing: extract invoicing service',
  'Observability: tracing for checkout funnel',
  'Fix flaky inventory reservation test',
];

async function wipeAuditUsers() {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@audit.local' } } });
}

async function wipeAll() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE code_reviews, commits, pull_requests, issues, generated_documents, impact_scores, integrations, users CASCADE',
  );
}

async function seedUser(email: string, name: string, months: number, density: number) {
  const user = await prisma.user.create({ data: { email, name, plan: 'FREE' } });
  const integration = await prisma.integration.create({
    data: {
      userId: user.id,
      provider: 'GITHUB',
      // Plaintext on purpose: mirrors how v0.1.0 stores real tokens (SEC finding).
      accessToken: `gho_AUDITFAKETOKEN_${hex(20)}`,
      metadata: { username: name.toLowerCase().split(' ')[0], name, avatar: null },
    },
  });

  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);

  // Commits: weekdays mostly, density per day.
  const commits = [];
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const n = weekend ? (rand() < 0.15 ? 1 : 0) : int(0, density);
    for (let i = 0; i < n; i++) {
      const ts = new Date(d);
      ts.setHours(int(8, 19), int(0, 59), int(0, 59));
      if (ts > now) continue;
      commits.push({
        userId: user.id,
        integrationId: integration.id,
        sha: hex(40),
        message: `${pick(VERBS)}: ${pick(SUBJECTS)}`,
        repo: pick(REPOS),
        branch: 'main',
        additions: int(1, 400),
        deletions: int(0, 200),
        timestamp: ts,
      });
    }
  }
  await prisma.commit.createMany({ data: commits });

  // Authored PRs (~3/week).
  const prs = [];
  let number = 100;
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 2)) {
    if (rand() > 0.45) continue;
    const ts = new Date(d);
    ts.setHours(int(9, 17));
    if (ts > now) continue;
    const r = rand();
    const state = r < 0.75 ? 'MERGED' : r < 0.9 ? 'CLOSED' : 'OPEN';
    const mergedAt = state === 'MERGED' ? new Date(ts.getTime() + int(2, 72) * 3600_000) : null;
    prs.push({
      userId: user.id,
      integrationId: integration.id,
      number: number++,
      title: pick(PR_TITLES),
      body: 'Authored PR (audit fixture)',
      state,
      repo: pick(REPOS),
      mergedAt: mergedAt && mergedAt > now ? null : mergedAt,
      timestamp: ts,
    });
  }
  await prisma.pullRequest.createMany({ data: prs });

  // Reviews of OTHER people's PRs. v0.1.0 has no way to store these except by creating a
  // stub PullRequest row owned by the reviewer ("PR #n", CLOSED) — replicate that.
  let stubNumber = 5000;
  let reviewCount = 0;
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    if (rand() > 0.35) continue;
    const ts = new Date(d);
    ts.setHours(int(9, 18), int(0, 59));
    if (ts > now) continue;
    const n = stubNumber++;
    const stub = await prisma.pullRequest.create({
      data: {
        userId: user.id,
        integrationId: integration.id,
        number: n,
        title: `PR #${n}`,
        body: 'STUB created for a reviewed-only PR (replicates sync.processor.ts:119-135)',
        state: 'CLOSED',
        repo: pick(REPOS),
        timestamp: ts,
      },
    });
    await prisma.codeReview.create({
      data: { userId: user.id, prId: stub.id, comments: int(0, 1), approved: rand() < 0.6, timestamp: ts },
    });
    reviewCount++;
  }

  // Impact scores for each month in range (normally LLM-generated).
  for (let m = 0; m <= months; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    await prisma.impactScore.create({
      data: {
        userId: user.id,
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        overall: int(55, 85),
        featureDelivery: int(50, 90),
        codeQuality: int(50, 90),
        collaboration: int(40, 90),
        leadership: int(30, 80),
        highlights: ['Shipped idempotent payment capture', 'Reduced /cart p95 latency', 'Reviewed 20+ PRs'],
      },
    });
  }

  // A couple of generated documents.
  const doc = await prisma.generatedDocument.create({
    data: {
      userId: user.id,
      type: 'RESUME',
      content: {
        bullets: [
          { text: 'Engineered idempotent payment capture, eliminating duplicate charges.', category: 'reliability', impact: 'Zero duplicate charges' },
          { text: 'Cut /cart p95 latency by caching search results in Redis.', category: 'performance', impact: '~30% faster' },
        ],
      },
      dateRange: { from: start.toISOString(), to: now.toISOString() },
    },
  });

  return {
    id: user.id,
    email,
    integrationId: integration.id,
    documentId: doc.id,
    commits: commits.length,
    authoredPRs: prs.length,
    stubPRs: reviewCount,
    reviews: reviewCount,
  };
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--wipe-all') {
    await wipeAll();
    console.log(JSON.stringify({ wiped: 'all' }));
    return;
  }
  await wipeAuditUsers();
  if (arg === '--wipe') {
    console.log(JSON.stringify({ wiped: 'audit users' }));
    return;
  }
  const alice = await seedUser('alice@audit.local', 'Alice Auditor', 6, 4);
  const bob = await seedUser('bob@audit.local', 'Bob Victim', 1, 2);
  console.log(JSON.stringify({ alice, bob }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
