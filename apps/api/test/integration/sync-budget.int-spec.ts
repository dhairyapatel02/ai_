import { buildLoadFixture } from '../fixtures/github/load-fixture';
import { createTestApp, type TestApp } from '../utils/app';
import { resetDatabase, resetRedisState } from '../utils/db';
import { buildFactories, type Factories } from '../utils/factories';
import { installFakeGitHub, type FakeGitHubState } from '../utils/fake-github';
import { activityCounts, connectGitHub, runSync } from '../utils/github-fixtures';

/** ADR-0007 API-call budget for the reference fixture: ≤ 250 requests, ≤ 2,500 GraphQL points. */
const REQUEST_BUDGET = 250;
const POINT_BUDGET = 2500;

describe('Sync API budget (load-ish, fake GitHub)', () => {
  let t: TestApp;
  let f: Factories;
  let gh: FakeGitHubState;
  let restore: () => void;

  beforeAll(async () => {
    t = await createTestApp();
    f = buildFactories(t.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await resetRedisState();
    ({ state: gh, restore } = installFakeGitHub());
  });

  afterEach(() => {
    restore();
  });

  afterAll(async () => {
    await t.close();
  });

  it('backfills 50 repos × 300 commits, 600 authored + 900 reviewed PRs within the request and point budget', async () => {
    gh.dataset = buildLoadFixture();
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id, {
      installations: [
        {
          id: 500,
          account: { login: 'load', type: 'Organization' },
          repository_selection: 'all',
          suspended_at: null,
        },
      ],
    });

    const { run } = await runSync(t, user.id, integration.id);

    expect(run.status).toBe('SUCCEEDED');
    expect(await activityCounts(t)).toEqual({
      repositories: 50,
      pullRequests: 1500,
      reviews: 900,
      commits: 15_000,
    });
    const requests = gh.log.length;
    // Recorded in PROGRESS.md / README "How sync works" (v0.1 needed 8,732 for 30 × 200).
    console.info(
      `[budget] requests=${requests} graphqlPoints=${gh.graphqlPoints} (budget ${REQUEST_BUDGET} / ${POINT_BUDGET})`,
    );
    expect(requests).toBeLessThanOrEqual(REQUEST_BUDGET);
    expect(gh.graphqlPoints).toBeLessThanOrEqual(POINT_BUDGET);
    expect(run.apiCalls).toBe(requests);
  }, 120_000);

  it('splits a search window whose result count exceeds the 1,000-result cap (no PR missed)', async () => {
    const now = Date.now();
    const base = buildLoadFixture(now);
    const recent = Array.from({ length: 1200 }, (_, i) => {
      const t = new Date(now - (i + 1) * 20 * 60_000).toISOString(); // all within the last 17 days
      return {
        nodeId: `PR_burst_${i}`,
        repo: 'load/repo-0',
        number: 20_000 + i,
        title: `Burst ${i}`,
        author: 'octo',
        state: 'OPEN' as const,
        createdAt: t,
        updatedAt: t,
      };
    });
    gh.dataset = { repos: base.repos.slice(0, 1), commits: [], pullRequests: recent };
    const user = await f.user();
    const integration = await connectGitHub(t, gh, user.id, {
      installations: [
        {
          id: 500,
          account: { login: 'load', type: 'Organization' },
          repository_selection: 'all',
          suspended_at: null,
        },
      ],
    });

    const { run } = await runSync(t, user.id, integration.id);
    expect(run.status).toBe('SUCCEEDED');
    expect(
      await t.prisma.pullRequest.count({ where: { userId: user.id, isAuthoredByUser: true } }),
    ).toBe(1200);
    const ranges = new Set(
      gh.log
        .filter((e) => e.operation === 'DevImpactAuthoredPRs')
        .map((e) => /updated:(\S+)/.exec(String(e.variables.q))?.[1]),
    );
    expect(ranges.size).toBeGreaterThan(13); // 13 slices + at least one split
  }, 120_000);
});
