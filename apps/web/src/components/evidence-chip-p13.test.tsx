import { describe, expect, it } from 'vitest';

import { detailsHref, shortRef } from './evidence-chip';

describe('EvidenceChip refs (P13)', () => {
  it('shortens MR, Jira and Linear refs', () => {
    expect(shortRef('MR-acme/platform/billing!12')).toBe('billing !12');
    expect(shortRef('REV-acme/platform/billing!12')).toBe('billing !12');
    expect(shortRef('JIRA-PAY-123')).toBe('PAY-123');
    expect(shortRef('LIN-ENG-42')).toBe('ENG-42');
    expect(shortRef('PR-acme/api#42')).toBe('api #42');
  });

  it('links issues to the Activity drawer', () => {
    expect(
      detailsHref({
        ref: 'JIRA-PAY-1',
        kind: 'issue',
        id: 'cmissue000000000000000001',
        title: 'x',
        repo: null,
        url: null,
        occurredAt: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe('/activity?item=issue:cmissue000000000000000001');
  });
});
