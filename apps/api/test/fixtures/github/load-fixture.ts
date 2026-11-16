import type { FakeDataset } from '../../utils/fake-github';

/**
 * ADR-0007 reference fixture (P06 budget test): 1 installation, 50 repositories × 300 commits,
 * 600 authored PRs and 900 reviewed PRs, spread evenly over a 12-month window ending `now`.
 */
export function buildLoadFixture(now = Date.now(), login = 'octo', nodeId = 'U_octo'): FakeDataset {
  const span = 360 * 86_400_000; // inside the 12-month window
  const at = (i: number, total: number) =>
    new Date(now - span + Math.floor(((i + 0.5) / total) * span)).toISOString();
  const repos = Array.from({ length: 50 }, (_, r) => ({
    nodeId: `R_load_${r}`,
    fullName: `load/repo-${r}`,
    installationId: 500,
    private: true,
  }));
  const commits = repos.flatMap((repo, r) =>
    Array.from({ length: 300 }, (_, c) => ({
      sha: `${r.toString(16).padStart(4, '0')}${c.toString(16).padStart(36, '0')}`,
      repo: repo.fullName,
      authorNodeId: nodeId,
      message: `feat: change ${c} in ${repo.fullName}`,
      authoredAt: at(c, 300),
      additions: 10,
      deletions: 2,
      changedFiles: 1,
    })),
  );
  const authored = Array.from({ length: 600 }, (_, i) => {
    const t = at(i, 600);
    return {
      nodeId: `PR_load_a${i}`,
      repo: repos[i % 50]?.fullName ?? '',
      number: 1000 + i,
      title: `Authored ${i}`,
      body: 'body',
      author: login,
      state: 'MERGED' as const,
      createdAt: t,
      updatedAt: t,
      mergedAt: t,
      closedAt: t,
      reviews: [{ id: `RV_load_r${i}`, author: 'alice', state: 'APPROVED', submittedAt: t }],
    };
  });
  const reviewed = Array.from({ length: 900 }, (_, i) => {
    const t = at(i, 900);
    return {
      nodeId: `PR_load_r${i}`,
      repo: repos[i % 50]?.fullName ?? '',
      number: 5000 + i,
      title: `Reviewed ${i}`,
      author: 'alice',
      state: 'MERGED' as const,
      createdAt: t,
      updatedAt: t,
      mergedAt: t,
      closedAt: t,
      reviews: [
        { id: `RV_load_m${i}`, author: login, state: 'APPROVED', submittedAt: t, comments: 1 },
      ],
    };
  });
  return { repos, commits, pullRequests: [...authored, ...reviewed] };
}
