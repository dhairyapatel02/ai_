import { describe, expect, it } from 'vitest';

import { DocumentListQuery } from '../api/documents';
import {
  escapeMarkdown,
  exportFilename,
  periodSlug,
  toExportDocument,
  toMarkdown,
  toPlainText,
} from './export';
import {
  documentSections,
  flaggedClaims,
  formatMetricValue,
  legacySections,
  moveContentItem,
  updateContentItem,
  writtenSections,
} from './render';

const metric = {
  key: 'prs_merged',
  label: 'PRs merged',
  unit: 'count',
  value: 33,
  n: 33,
  status: 'ok',
  previousValue: null,
  delta: null,
  deltaPct: null,
  direction: 'higher_is_better',
  inScore: true,
  evidence: [],
  evidenceTruncated: false,
} as const;

const appraisal = {
  sections: {
    // JSONB key order differs from the document order.
    growth: [{ id: 'gr1', text: 'Took on larger changes.', citations: ['PR-acme/infra#306'] }],
    metrics: [metric],
    nextGoals: [{ id: 'ng1', text: 'Lead a design review.' }],
    areasOfImpact: [{ id: 'ai1', text: 'Reliability work.', citations: [], flags: ['uncited'] }],
    executiveSummary: {
      id: 'es1',
      text: 'I focused on *reliability* [link](javascript:alert(1)).',
      citations: ['PR-acme/infra#306', 'PR-acme/web-app#137'],
    },
    keyContributions: [
      {
        id: 'kc1',
        title: 'CSV export',
        text: 'Streamed exports.',
        citations: ['PR-acme/infra#306'],
      },
    ],
  },
};

const evidence = [
  {
    ref: 'PR-acme/infra#306',
    kind: 'pull_request' as const,
    id: 'cmwpv07cw00e9o57d1g442l96',
    title: 'CSV export streaming',
    repo: 'acme/infra',
    url: 'https://github.com/acme/infra/pull/306',
    occurredAt: '2026-07-30T22:00:00.000Z',
  },
];

describe('documentSections', () => {
  it('orders sections per type and marks engine metrics', () => {
    const { sections, legacy } = documentSections('appraisal', appraisal);
    expect(legacy).toBe(false);
    expect(sections.map((s) => s.key)).toEqual([
      'executiveSummary',
      'keyContributions',
      'metrics',
      'areasOfImpact',
      'growth',
      'nextGoals',
    ]);
    expect(sections[2]?.kind).toBe('metrics');
    expect(flaggedClaims(sections)).toBe(1);
    const goals = sections[5];
    expect(goals?.kind === 'items' && goals.cited).toBe(false);
  });

  it('accepts partial streaming content', () => {
    const { sections } = documentSections('appraisal', {
      sections: { keyContributions: [undefined, { title: 'B', text: 'Second', citations: [] }] },
    });
    expect(sections).toHaveLength(1);
    const first = sections[0];
    expect(first?.kind === 'items' && first.items.map((i) => i.index)).toEqual([1]);
  });

  it('renders resume narrative as paragraphs and keeps bullet curation', () => {
    const narrative = documentSections('resume', {
      format: 'narrative',
      summary: null,
      bullets: [{ id: 'b1', text: 'Para', citations: [], theme: 'Delivery' }],
    });
    expect(narrative.sections[0]).toMatchObject({ label: 'Narrative', shape: 'claim' });
    const bullets = documentSections('resume', {
      format: 'bullets',
      summary: null,
      bullets: [{ id: 'b1', text: 'One', citations: [], theme: 'Delivery', pinned: true }],
    });
    const s = bullets.sections[0];
    expect(s?.kind === 'items' && s.items[0]).toMatchObject({ theme: 'Delivery', pinned: true });
  });

  it('renders v0.1 imports as readable sections, never JSON', () => {
    const sections = legacySections({
      executiveSummary: 'Dana delivered the roadmap.',
      metrics: { prCount: 66, reviewCount: 91 },
      keyContributions: [{ title: 'Idempotent payments', evidence: 'Payments: idempotent intent' }],
      bullets: [{ text: 'Led the redesign', category: 'reliability' }],
      ignored: { nested: { deep: true } },
    });
    expect(sections.map((s) => s.label)).toEqual([
      'Executive summary',
      'Metrics',
      'Key contributions',
      'Bullets',
    ]);
    expect(sections[1]).toMatchObject({
      kind: 'table',
      rows: [
        ['Pr count', '66'],
        ['Review count', '91'],
      ],
    });
    expect(documentSections('resume', { legacy: true, raw: { bullets: ['a'] } }).legacy).toBe(true);
  });

  it('lists the sections the model writes', () => {
    expect(writtenSections('promotion').map((s) => s.key)).not.toContain('supportingData');
    expect(writtenSections('resume')).toHaveLength(2);
  });
});

describe('content edits', () => {
  it('updates one item and moves bullets immutably', () => {
    const resume = {
      format: 'bullets',
      summary: null,
      bullets: [
        { id: 'b1', text: 'One', citations: [], theme: 'A' },
        { id: 'b2', text: 'Two', citations: [], theme: 'B' },
      ],
    };
    const edited = updateContentItem(resume, 'bullets', 1, { text: 'Two!', pinned: true });
    expect(edited).toMatchObject({ bullets: [{ text: 'One' }, { text: 'Two!', pinned: true }] });
    expect(resume.bullets[1]?.text).toBe('Two');
    const unpinned = updateContentItem(edited, 'bullets', 1, { pinned: false }) as typeof resume;
    expect('pinned' in (unpinned.bullets[1] ?? {})).toBe(false);
    expect(moveContentItem(resume, 'bullets', 1, 0)).toMatchObject({
      bullets: [{ id: 'b2' }, { id: 'b1' }],
    });
    const summary = updateContentItem(appraisal, 'executiveSummary', null, { text: 'New' });
    expect(summary).toMatchObject({ sections: { executiveSummary: { text: 'New', id: 'es1' } } });
  });
});

describe('formatMetricValue', () => {
  it('formats units and insufficient values', () => {
    expect(formatMetricValue({ value: 0.456, unit: 'ratio', status: 'ok' })).toBe('46%');
    expect(formatMetricValue({ value: 13, unit: 'hours', status: 'ok' })).toBe('13.0 h');
    expect(formatMetricValue({ value: null, unit: 'count', status: 'insufficient_data' })).toBe(
      'Not enough data',
    );
  });
});

describe('exports', () => {
  const doc = toExportDocument({
    type: 'appraisal',
    title: 'Appraisal · H2 2026',
    periodLabel: 'H2 2026',
    version: 3,
    content: appraisal,
    evidence,
  });

  it('numbers footnotes by first appearance and resolves evidence', () => {
    expect(doc.subtitle).toBe('Appraisal · H2 2026 · Version 3');
    expect(doc.footnotes).toEqual([
      expect.objectContaining({ n: 1, ref: 'PR-acme/infra#306', title: 'CSV export streaming' }),
      expect.objectContaining({ n: 2, ref: 'PR-acme/web-app#137', title: null, url: null }),
    ]);
  });

  it('serializes Markdown with escaped model text', () => {
    const md = toMarkdown(doc);
    expect(md).toMatchSnapshot();
    expect(md).not.toContain('[link](javascript');
    expect(md).toContain('\\[link\\]');
  });

  it('serializes plain text', () => {
    expect(toPlainText(doc)).toMatchSnapshot();
  });

  it('omits citations for resumes unless asked', () => {
    const resume = {
      format: 'bullets',
      summary: { id: 's1', text: 'Backend engineer.', citations: ['PR-acme/infra#306'] },
      bullets: [
        { id: 'b1', text: 'Shipped X', citations: ['PR-acme/infra#306'], theme: 'Delivery' },
      ],
    };
    const base = {
      type: 'resume' as const,
      title: 'Resume',
      periodLabel: null,
      version: 1,
      content: resume,
      evidence,
    };
    expect(toExportDocument(base).footnotes).toEqual([]);
    expect(toMarkdown(toExportDocument(base))).not.toContain('[^1]');
    expect(toExportDocument({ ...base, citations: true }).footnotes).toHaveLength(1);
  });

  it('escapes markdown syntax at the start of a line and entities', () => {
    expect(escapeMarkdown('# Heading')).toBe('\\# Heading');
    expect(escapeMarkdown('1. item')).toBe('1\\. item');
    expect(escapeMarkdown('<img src=x onerror=1>')).toBe('\\<img src=x onerror=1\\>');
    expect(escapeMarkdown('&lt;script&gt; and A&B')).toBe('&amp;lt;script&amp;gt; and A&B');
    expect(escapeMarkdown('line\nbreak‮')).toBe('line break');
  });

  it('builds safe filenames', () => {
    expect(exportFilename('appraisal', 'half:2026-H2', 1, 'pdf')).toBe('appraisal-2026-H2-v1.pdf');
    expect(exportFilename('resume', 'custom:2025-11-21..2026-11-20', 2, 'docx')).toBe(
      'resume-2025-11-21_2026-11-20-v2.docx',
    );
    expect(exportFilename('impact_narrative', null, 1, 'md')).toBe(
      'impact-narrative-undated-v1.md',
    );
    expect(periodSlug('custom:"../x"\r\n')).toBe('_x');
  });
});

describe('DocumentListQuery status filter', () => {
  it('parses a comma list and rejects unknown statuses', () => {
    expect(DocumentListQuery.parse({ status: 'pending,streaming' }).status).toEqual([
      'pending',
      'streaming',
    ]);
    expect(DocumentListQuery.safeParse({ status: 'done' }).success).toBe(false);
  });
});
