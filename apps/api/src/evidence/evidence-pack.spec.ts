import { buildCase } from '../../test/evals/eval-core';
import { PERSONAS } from '../../test/evals/personas';
import { formatMetric, promptEvidence, scorePr, tagsOf, type PrRecord } from './evidence-pack';
import { allowedNumbers, untracedNumbers } from './numbers';

const pr = (over: Partial<PrRecord>): PrRecord => ({
  id: 'c00000000000000000000001',
  number: 1,
  title: 'Change',
  body: null,
  url: null,
  state: 'MERGED',
  labels: [],
  createdAt: new Date('2026-10-01T00:00:00Z'),
  mergedAt: new Date('2026-10-02T00:00:00Z'),
  additions: 100,
  deletions: 20,
  changedFiles: 3,
  commitsCount: 2,
  reviewersCount: 1,
  changesRequestedCount: 0,
  revertedAt: null,
  isRevert: false,
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  repo: { fullName: 'acme/api', isPrivate: false, htmlUrl: null },
  ...over,
});

describe('EvidenceBuilder core (deterministic ranking, ADR-0009)', () => {
  it('ranks merged, reviewed, incident/perf work above tiny or reverted changes', () => {
    expect(scorePr(pr({ labels: ['incident'], reviewersCount: 3 }))).toBeGreaterThan(
      scorePr(pr({})),
    );
    expect(scorePr(pr({ additions: 5, deletions: 1 }))).toBeLessThan(scorePr(pr({})));
    expect(scorePr(pr({ revertedAt: new Date() }))).toBeLessThan(scorePr(pr({})));
    expect(scorePr(pr({ mergedAt: null, state: 'OPEN' }))).toBeLessThan(scorePr(pr({})));
    // Huge PRs are not rewarded beyond large ones (anti-gaming).
    expect(scorePr(pr({ additions: 5000, deletions: 0 }))).toBeLessThanOrEqual(
      scorePr(pr({ additions: 600, deletions: 0 })),
    );
    expect(tagsOf('Speed up checkout with caching', ['bug'])).toEqual(['performance', 'bugfix']);
  });

  it('is deterministic and the same records always give the same pack', () => {
    const a = buildCase(PERSONAS[0], 'resume').pack;
    const b = buildCase(PERSONAS[0], 'resume').pack;
    expect(a.items.map((i) => i.ref)).toEqual(b.items.map((i) => i.ref));
    expect(a.items[0].kind).toBe('pull_request');
    expect(new Set(a.items.map((i) => i.ref)).size).toBe(a.items.length);
  });

  it('redacts private repository names for the model but keeps real refs (F-76)', () => {
    const pack = buildCase(
      PERSONAS.find((p) => p.key === 'private-redacted')!,
      'resume',
    ).pack;
    const text = JSON.stringify(promptEvidence(pack));
    expect(text).not.toContain('secret-merger-project');
    expect(text).toContain('private/repo-1');
    const priv = pack.items.find((i) => i.repo === 'acme/secret-merger-project')!;
    expect(priv.ref).toMatch(/^PR-acme\/secret-merger-project#/);
    expect(priv.promptRef).toMatch(/^PR-private\/repo-1#/);
    expect(pack.redacted).toBe(true);
  });

  it('formats metric values the only way prose may cite them, and traces numbers', () => {
    expect(formatMetric('ratio', 0.7234)).toBe('72%');
    expect(formatMetric('hours', 5.26)).toBe('5.3 hours');
    expect(formatMetric('count', 7)).toBe('7');
    const pack = buildCase(PERSONAS[0], 'appraisal').pack;
    const allowed = allowedNumbers(pack);
    const merged = pack.metrics.find((m) => m.key === 'prs_merged')!.display!;
    expect(untracedNumbers(`Merged ${merged} pull requests in October 2026.`, allowed)).toEqual([]);
    expect(untracedNumbers('Saved 1234 hours.', allowed)).toEqual(['1234']);
  });
});
