/**
 * Port of the P01 audit fixture (`docs/v2/audit/scripts/seed-fixture.ts`, same PRNG sequence and
 * generation rules) that emits v0.1-schema rows instead of writing through the (now v2) Prisma
 * client. The original is relative to "now"; pinning `now` makes counts deterministic. At the P01
 * run date Alice had 106 PRs of which 65 were "PR #n" stubs (41 authored).
 */
export interface LegacyRows {
  users: { id: string; email: string; name: string }[];
  integrations: { id: string; userId: string; login: string }[];
  commits: {
    id: string;
    userId: string;
    integrationId: string;
    sha: string;
    message: string;
    repo: string;
    timestamp: Date;
  }[];
  pullRequests: {
    id: string;
    userId: string;
    integrationId: string;
    number: number;
    title: string;
    body: string | null;
    state: string;
    repo: string;
    mergedAt: Date | null;
    timestamp: Date;
  }[];
  codeReviews: {
    id: string;
    userId: string;
    prId: string;
    comments: number;
    approved: boolean;
    timestamp: Date;
  }[];
  summary: Record<string, { commits: number; authoredPRs: number; stubPRs: number }>;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REPOS = [
  'acme/checkout-service',
  'acme/web-app',
  'acme/platform-infra',
  'alice/dotfiles',
  'acme/search-api',
];
const VERBS = ['feat', 'fix', 'refactor', 'perf', 'chore', 'test', 'docs'];
const SUBJECTS = [
  'add retry to payment webhook handler',
  'cache product search results in redis',
  'reduce p95 latency of /cart endpoint',
  'fix race condition in inventory reservation',
];
const PR_TITLES = [
  'Checkout: idempotent payment capture',
  'Search: Redis result cache with TTL',
  'Orders API: cursor pagination',
  'Fix flaky inventory reservation test',
];

export function buildP01Fixture(nowIso: string): LegacyRows {
  const rand = rng(42);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  let ids = 0;
  const id = () => `cfixture${(++ids).toString(36).padStart(17, '0')}`;
  const rows: LegacyRows = {
    users: [],
    integrations: [],
    commits: [],
    pullRequests: [],
    codeReviews: [],
    summary: {},
  };

  for (const [email, name, months, density] of [
    ['alice@audit.local', 'Alice Auditor', 6, 4],
    ['bob@audit.local', 'Bob Victim', 1, 2],
  ] as const) {
    const user = { id: id(), email, name };
    rows.users.push(user);
    hex(8);
    const integration = {
      id: id(),
      userId: user.id,
      login: name.toLowerCase().split(' ')[0] ?? 'x',
    };
    rows.integrations.push(integration);
    const now = new Date(nowIso);
    const start = new Date(now);
    start.setMonth(start.getMonth() - months);
    const base = { userId: user.id, integrationId: integration.id };

    let commits = 0;
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const n = weekend ? (rand() < 0.15 ? 1 : 0) : int(0, density);
      for (let i = 0; i < n; i++) {
        const ts = new Date(d);
        ts.setHours(int(8, 19), int(0, 59), int(0, 59));
        if (ts > now) continue;
        const sha = hex(40);
        const message = `${pick(VERBS)}: ${pick(SUBJECTS)}`;
        const repo = pick(REPOS);
        int(1, 400);
        int(0, 200);
        rows.commits.push({ id: id(), ...base, sha, message, repo, timestamp: ts });
        commits++;
      }
    }

    let number = 100;
    let authored = 0;
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 2)) {
      if (rand() > 0.45) continue;
      const ts = new Date(d);
      ts.setHours(int(9, 17));
      if (ts > now) continue;
      const r = rand();
      const state = r < 0.75 ? 'MERGED' : r < 0.9 ? 'CLOSED' : 'OPEN';
      const mergedAt = state === 'MERGED' ? new Date(ts.getTime() + int(2, 72) * 3600_000) : null;
      rows.pullRequests.push({
        id: id(),
        ...base,
        number: number++,
        title: pick(PR_TITLES),
        body: 'Authored PR (audit fixture)',
        state,
        repo: pick(REPOS),
        mergedAt: mergedAt && mergedAt > now ? null : mergedAt,
        timestamp: ts,
      });
      authored++;
    }

    // v0.1 stored reviewed-only PRs as the reviewer's own "PR #n" CLOSED rows (DATA-01).
    let stubNumber = 5000;
    let stubs = 0;
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      if (rand() > 0.35) continue;
      const ts = new Date(d);
      ts.setHours(int(9, 18), int(0, 59));
      if (ts > now) continue;
      const n = stubNumber++;
      const stub = {
        id: id(),
        ...base,
        number: n,
        title: `PR #${n}`,
        body: 'STUB created for a reviewed-only PR (replicates sync.processor.ts:119-135)',
        state: 'CLOSED',
        repo: pick(REPOS),
        mergedAt: null,
        timestamp: ts,
      };
      rows.pullRequests.push(stub);
      rows.codeReviews.push({
        id: id(),
        userId: user.id,
        prId: stub.id,
        comments: int(0, 1),
        approved: rand() < 0.6,
        timestamp: ts,
      });
      stubs++;
    }
    for (let m = 0; m <= months; m++) for (let k = 0; k < 5; k++) rand(); // impact scores (not migrated)
    rows.summary[email] = { commits, authoredPRs: authored, stubPRs: stubs };
  }
  return rows;
}
