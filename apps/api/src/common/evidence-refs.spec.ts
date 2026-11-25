import { EVIDENCE_REF_PATTERN } from '@devimpact/shared';

import { commitUrl, issueRef, prRef, repoRef, reviewRef } from './evidence-refs';

describe('evidence refs (KPI §7, D-030)', () => {
  it('formats GitHub, GitLab, Jira and Linear refs', () => {
    expect(prRef('acme/api', 42)).toBe('PR-acme/api#42');
    expect(prRef('acme/platform/api', 12, 'GITLAB')).toBe('MR-acme/platform/api!12');
    expect(reviewRef('acme/platform/api', 12, 'gitlab')).toBe('REV-acme/platform/api!12');
    expect(reviewRef('acme/api', 7, 'GITHUB')).toBe('REV-acme/api#7');
    expect(issueRef('JIRA', 'PAY-123')).toBe('JIRA-PAY-123');
    expect(issueRef('linear', 'ENG-42')).toBe('LIN-ENG-42');
  });

  it('every format matches the shared EvidenceRef pattern', () => {
    for (const ref of [
      'PR-acme/api#42',
      'MR-acme/platform/api!12',
      'REV-a/b!1',
      'C-a/b@1a2b3c4',
      'JIRA-PAY-1',
      'LIN-ENG-42',
      'ACH-cabc',
    ]) {
      expect(ref).toMatch(EVIDENCE_REF_PATTERN);
    }
    expect('XYZ-1').not.toMatch(EVIDENCE_REF_PATTERN);
  });

  it('links GitLab commits under /-/commit/ and adds the provider to repo refs', () => {
    expect(commitUrl('https://gitlab.com/a/b', 'abc', 'GITLAB')).toBe(
      'https://gitlab.com/a/b/-/commit/abc',
    );
    expect(commitUrl('https://github.com/a/b', 'abc')).toBe('https://github.com/a/b/commit/abc');
    expect(commitUrl('javascript:alert(1)', 'abc')).toBeNull();
    expect(repoRef({ id: 'r', fullName: 'a/b', integration: { provider: 'GITLAB' } })).toEqual({
      id: 'r',
      fullName: 'a/b',
      provider: 'gitlab',
    });
  });
});
