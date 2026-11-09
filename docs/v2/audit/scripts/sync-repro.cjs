/**
 * AUDIT HELPER — runs v0.1.0's REAL SyncProcessor + GitHubService (compiled output in
 * apps/api/dist) against the local Postgres, with GitHub's REST API replaced by an
 * in-process fake (global fetch stub; octokit v4 uses global fetch). No app code changed.
 *
 *   set -a; . ./.env; set +a
 *   (cd apps/api && npx nest build)     # or have `npm run dev:api` running, which emits dist/
 *   node docs/v2/audit/scripts/sync-repro.cjs correctness
 *   node docs/v2/audit/scripts/sync-repro.cjs scale        # 70 repos, 30 synced x 200 commits
 *
 * correctness: proves (1) reviewed-only PRs are stored as the user's own stub PRs,
 *              (2) a rate-limited repo is silently skipped while the job "succeeds",
 *              (3) review `comments` is 0/1 from the review body, not a comment count.
 * scale:       counts the GitHub requests one full sync makes.
 */
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const dist = path.join(root, 'apps/api/dist');
require(path.join(root, 'node_modules/reflect-metadata'));
const { SyncProcessor } = require(path.join(dist, 'sync/sync.processor.js'));
const { GitHubService } = require(path.join(dist, 'github/github.service.js'));
const { PrismaService } = require(path.join(dist, 'prisma/prisma.service.js'));

const mode = process.argv[2] || 'correctness';
const LOGIN = 'alice-sync';
const now = Date.now();
const daysAgo = (d) => new Date(now - d * 86400_000).toISOString();

// ---------------------------------------------------------------- fake GitHub world
function buildWorld() {
  if (mode === 'scale') {
    const repos = Array.from({ length: 70 }, (_, i) => `org/repo-${i}`);
    const world = { repos, commits: {}, pulls: {}, reviews: {}, rateLimited: new Set() };
    for (const r of repos) {
      world.commits[r] = Array.from({ length: 200 }, (_, i) => ({ sha: `${r}-c${i}`, date: daysAgo(i % 170), msg: `feat: work ${i}` }));
      // 600 PRs per repo, newest first by updated_at; 150 updated inside the 6-month window.
      world.pulls[r] = Array.from({ length: 600 }, (_, i) => ({
        number: 600 - i, user: i % 6 === 0 ? LOGIN : 'teammate', state: i % 3 ? 'closed' : 'open',
        merged_at: i % 3 ? daysAgo(i) : null, created_at: daysAgo(i * 1.2), updated_at: daysAgo(i * 1.2), title: `PR ${600 - i}`, body: null,
      }));
      for (const p of world.pulls[r]) world.reviews[`${r}#${p.number}`] = p.user === LOGIN ? [] : [{ user: LOGIN, state: 'APPROVED', body: '', submitted_at: p.updated_at }];
    }
    return world;
  }
  return {
    repos: ['acme/app', 'acme/lib'],
    rateLimited: new Set(['acme/lib']), // every call to acme/lib returns a secondary rate limit 403
    commits: {
      'acme/app': [
        { sha: 'a1', date: daysAgo(3), msg: 'feat: add checkout retry\n\nlong body' },
        { sha: 'a2', date: daysAgo(10), msg: 'fix: null pointer in cart' },
        { sha: 'a3', date: daysAgo(40), msg: 'refactor: split service' },
      ],
      'acme/lib': [{ sha: 'l1', date: daysAgo(5), msg: 'feat: important library work' }],
    },
    pulls: {
      'acme/app': [
        { number: 4, user: LOGIN, state: 'open', merged_at: null, created_at: daysAgo(1), updated_at: daysAgo(1), title: 'WIP: new search', body: null },
        { number: 3, user: 'carol', state: 'closed', merged_at: null, created_at: daysAgo(6), updated_at: daysAgo(5), title: "Carol's refactor", body: null },
        { number: 2, user: 'bob', state: 'open', merged_at: null, created_at: daysAgo(8), updated_at: daysAgo(7), title: "Bob's feature", body: null },
        { number: 1, user: LOGIN, state: 'closed', merged_at: daysAgo(12), created_at: daysAgo(14), updated_at: daysAgo(12), title: 'Checkout retry', body: 'desc' },
      ],
      'acme/lib': [],
    },
    reviews: {
      'acme/app#3': [{ user: LOGIN, state: 'COMMENTED', body: 'see 7 inline comments', submitted_at: daysAgo(5) }],
      'acme/app#2': [
        { user: LOGIN, state: 'CHANGES_REQUESTED', body: '', submitted_at: daysAgo(7.5) },
        { user: LOGIN, state: 'APPROVED', body: '', submitted_at: daysAgo(7) },
      ],
      'acme/app#1': [{ user: 'bob', state: 'APPROVED', body: 'lgtm', submitted_at: daysAgo(13) }],
    },
  };
}
const world = buildWorld();
const calls = {};
const count = (k) => (calls[k] = (calls[k] || 0) + 1);

function json(body, { status = 200, link, headers = {} } = {}) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999', ...headers });
  if (link) h.set('link', link);
  return new Response(JSON.stringify(body), { status, headers: h });
}
function paged(items, url, defaultPer = 30) {
  const per = Number(url.searchParams.get('per_page') || defaultPer);
  const page = Number(url.searchParams.get('page') || 1);
  const slice = items.slice((page - 1) * per, page * per);
  let link;
  if (page * per < items.length) {
    const next = new URL(url); next.searchParams.set('page', String(page + 1));
    link = `<${next}>; rel="next"`;
  }
  return json(slice, { link });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const p = url.pathname;
  let m;
  if (p === '/user') { count('GET /user'); return json({ login: LOGIN }); }
  if (p === '/user/repos') { count('GET /user/repos'); return paged(world.repos.map((full_name) => ({ full_name })), url); }
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/(.*)$/))) {
    const repo = m[1]; const rest = m[2];
    if (world.rateLimited.has(repo)) {
      count(`403 secondary-rate-limit ${repo}`);
      return json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403, headers: { 'retry-after': '0' } });
    }
    if (rest === 'commits') {
      count('GET /repos/:r/commits (list page)');
      const since = url.searchParams.get('since');
      const items = (world.commits[repo] || []).filter((c) => !since || c.date >= since)
        .map((c) => ({ sha: c.sha, commit: { message: c.msg, author: { date: c.date } } }));
      return paged(items, url);
    }
    if ((m = rest.match(/^commits\/(.+)$/))) { count('GET /repos/:r/commits/:sha (N+1 stats)'); return json({ sha: m[1], stats: { additions: 10, deletions: 2 } }); }
    if (rest === 'pulls') {
      count(`GET /repos/:r/pulls (list page, per_page=${url.searchParams.get('per_page')})`);
      return paged((world.pulls[repo] || []).map((x) => ({ ...x, user: { login: x.user } })), url);
    }
    if ((m = rest.match(/^pulls\/(\d+)\/reviews$/))) {
      count('GET /repos/:r/pulls/:n/reviews');
      return json((world.reviews[`${repo}#${m[1]}`] || []).map((r) => ({ ...r, user: { login: r.user } })));
    }
  }
  count(`UNHANDLED ${p}`);
  return json({ message: 'Not Found' }, { status: 404 });
};

// ---------------------------------------------------------------- run
(async () => {
  const prisma = new PrismaService();
  await prisma.$connect();
  const email = `sync-repro-${mode}@audit.local`;
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email, name: 'Sync Repro' } });
  const integ = await prisma.integration.create({ data: { userId: user.id, provider: 'GITHUB', accessToken: 'gho_fake', metadata: {} } });

  const processor = new SyncProcessor(prisma, new GitHubService());
  const progress = [];
  const job = { data: { userId: user.id, integrationId: integ.id }, updateProgress: async (v) => progress.push(v) };
  const t0 = Date.now();
  let result, error;
  try { result = await processor.process(job); } catch (e) { error = String(e); }
  const ms = Date.now() - t0;

  const prs = await prisma.pullRequest.findMany({ where: { userId: user.id }, orderBy: [{ repo: 'asc' }, { number: 'asc' }] });
  const reviews = await prisma.codeReview.findMany({ where: { userId: user.id }, include: { pr: { select: { number: true, title: true } } } });
  const commits = await prisma.commit.findMany({ where: { userId: user.id } });
  const totalCalls = Object.values(calls).reduce((a, b) => a + b, 0);

  const out = {
    mode, durationMs: ms, jobResult: result ?? null, jobError: error ?? null, progressUpdates: progress.length, lastProgress: progress.at(-1),
    githubCalls: { total: totalCalls, byEndpoint: calls },
    db: {
      commits: commits.length,
      commitBranches: [...new Set(commits.map((c) => c.branch))],
      pullRequests: mode === 'scale' ? { count: prs.length, stubs: prs.filter((p) => /^PR #\d+$/.test(p.title)).length }
        : prs.map((p) => ({ repo: p.repo, number: p.number, title: p.title, state: p.state, mergedAt: p.mergedAt, authoredByUser: !/^PR #/.test(p.title) })),
      codeReviews: mode === 'scale' ? reviews.length : reviews.map((r) => ({ pr: r.pr.number, prTitleStored: r.pr.title, approved: r.approved, comments: r.comments })),
    },
  };
  console.log(JSON.stringify(out, null, 2));
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
})();
