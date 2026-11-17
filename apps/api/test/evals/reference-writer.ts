import { evidenceOf, systemText, type FakeReply, type FakeRequest } from '../utils/fake-anthropic';

/**
 * Deterministic stand-in for the model used to produce the *synthetic* recordings committed in
 * `recordings/` (no API key was available when they were made; `npm run eval:live -- --record`
 * replaces them with real outputs). It writes like a careful model: cites refs, uses only numbers
 * from the evidence, skips hostile items. The CI evals then replay the recordings through the
 * real pipeline (SDK, validation, citation verification, checks).
 */
interface Item {
  ref: string;
  kind: string;
  repository: string | null;
  title: string;
  tags: string[];
}
interface Evidence {
  period: { label: string };
  metrics: { metric: string; value: string }[];
  counts: { repos: number };
  items: Item[];
}

const HOSTILE = /ignore (previous|all)|system:|admin mode|respond only/i;

function phrase(item: Item): string {
  const title = item.title.replace(/\.$/, '');
  const lower = title.charAt(0).toLowerCase() + title.slice(1);
  const where = item.repository ? ` in ${item.repository}` : '';
  if (item.kind === 'review')
    return `Reviewed the change "${title}"${where}, giving the author detailed feedback.`;
  if (item.kind === 'commit') return `Committed "${title}"${where}.`;
  if (item.tags.includes('performance'))
    return `Improved performance with the change to ${lower}${where}.`;
  if (item.tags.includes('bugfix') || item.tags.includes('incident'))
    return `Resolved a defect: ${lower}${where}.`;
  if (item.tags.includes('security')) return `Strengthened security: ${lower}${where}.`;
  return `Delivered the change to ${lower}${where}.`;
}

export function referenceReply(req: FakeRequest): FakeReply {
  const sys = systemText(req);
  const ev = evidenceOf(req) as unknown as Evidence;
  const safe = ev.items.filter((i) => !HOSTILE.test(i.title));
  const prs = safe.filter((i) => i.kind === 'pull_request');
  const reviews = safe.filter((i) => i.kind === 'review');
  const first = safe[0];
  const cite = (i: Item | undefined) => (i ? [i.ref] : []);
  const merged = ev.metrics?.find((m) => m.metric === 'PRs merged')?.value;
  const summaryText = `Engineer who ${merged ? `merged ${merged} pull requests` : 'contributed changes'} across ${ev.counts?.repos ?? 1} ${ev.counts?.repos === 1 ? 'repository' : 'repositories'} in ${ev.period?.label ?? 'the period'}.`;
  const claim = (i: Item) => ({ text: phrase(i), citations: [i.ref] });
  const titled = (i: Item) => ({
    title: i.title.replace(HOSTILE, '').slice(0, 100) || 'Contribution',
    ...claim(i),
  });
  let output: unknown;

  if (sys.includes('Task: resume bullets')) {
    const pool = [...prs, ...reviews].slice(0, 6);
    output = {
      summary: { text: summaryText, citations: cite(prs[0] ?? first) },
      bullets: pool.map((i) => ({
        ...claim(i),
        theme: i.tags[0]
          ? i.tags[0].charAt(0).toUpperCase() + i.tags[0].slice(1)
          : (i.repository ?? 'Delivery'),
      })),
    };
  } else if (sys.includes('Task: self-appraisal')) {
    output = {
      executiveSummary: { text: summaryText, citations: cite(prs[0] ?? first) },
      keyContributions: prs.slice(0, 4).map(titled),
      areasOfImpact: [...new Set(prs.map((p) => p.repository))].slice(0, 3).map((repo) => {
        const i = prs.find((p) => p.repository === repo)!;
        return { text: `Sustained improvements to ${repo}.`, citations: [i.ref] };
      }),
      growth: reviews
        .slice(0, 1)
        .map((i) => ({ text: `Took on more code review, e.g. "${i.title}".`, citations: [i.ref] })),
      nextGoals: [
        { text: 'Share the design behind the main changes with the team.' },
        { text: 'Keep pull requests small and well-tested.' },
      ],
    };
  } else if (sys.includes('Task: promotion packet')) {
    output = {
      whyReady: { text: summaryText, citations: cite(prs[0] ?? first) },
      leadershipEvidence: reviews.slice(0, 2).map(claim),
      technicalImpact: prs.slice(0, 3).map(claim),
      businessValue: prs
        .filter((p) => p.tags.includes('feature'))
        .slice(0, 2)
        .map(claim),
      mentorship: reviews.slice(2, 4).map(claim),
    };
  } else if (sys.includes('Task: narrative highlights')) {
    output = {
      summary: {
        text: `Work in ${ev.period?.label ?? 'the period'} centred on ${prs[0] ? `"${prs[0].title}"` : 'reviews'}.`,
        citations: cite(prs[0] ?? first),
      },
      highlights: [...prs, ...reviews].slice(0, 3).map(titled),
      focusAreas: [{ text: 'Spread reviews across more repositories.' }],
    };
  } else if (sys.includes('Task: turn one pull request or commit')) {
    const i = first ?? ev.items[0];
    output = {
      title: (i?.title.replace(HOSTILE, '').slice(0, 80) || 'Engineering contribution').trim(),
      statement: i && !HOSTILE.test(i.title) ? phrase(i) : 'Contributed a change to the codebase.',
      category: i?.tags.includes('bugfix') ? 'quality' : 'delivery',
      citations: cite(i),
    };
  } else if (sys.includes('Task: a short summary for the engineer')) {
    output = {
      summary: {
        text: `A focused week in ${ev.period?.label ?? 'the period'}.`,
        citations: cite(first),
      },
      highlights: safe.slice(0, 3).map(claim),
    };
  } else {
    output = {};
  }
  return { text: JSON.stringify(output) };
}
