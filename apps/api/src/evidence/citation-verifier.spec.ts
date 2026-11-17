import { allowedRefs, verifyCitations } from './citation-verifier';

const allowed = allowedRefs([
  { ref: 'PR-acme/api#1', promptRef: 'PR-acme/api#1' },
  { ref: 'PR-acme/secret#2', promptRef: 'PR-private/repo-1#2' },
]);

describe('citation verification (F-45)', () => {
  it('maps aliases to real refs, drops and flags invalid refs, flags uncited claims, computes coverage', () => {
    const content = {
      summary: { id: 's1', text: 'A', citations: ['PR-private/repo-1#2'] },
      bullets: [
        { id: 'b1', text: 'B', citations: ['PR-acme/api#1', 'PR-acme/api#1', 'PR-evil/x#9'] },
        { id: 'b2', text: 'C', citations: [], flags: ['uncited'] },
        { id: 'b3', text: 'D', citations: [' PR-acme/api#1 '], flags: ['invalid_citation'] },
      ],
      metrics: [{ key: 'prs_merged', value: 2, evidence: ['cx'] }],
      goals: [{ id: 'g1', text: 'no citations here' }],
    };
    const r = verifyCitations(content, allowed);
    expect(r.content.summary).toEqual({ id: 's1', text: 'A', citations: ['PR-acme/secret#2'] });
    expect(r.content.bullets[0]).toEqual({
      id: 'b1',
      text: 'B',
      citations: ['PR-acme/api#1'],
      flags: ['invalid_citation'],
    });
    expect(r.content.bullets[1].flags).toEqual(['uncited']);
    expect(r.content.bullets[2]).toEqual({ id: 'b3', text: 'D', citations: ['PR-acme/api#1'] });
    expect(r.content.metrics).toEqual(content.metrics);
    expect(r).toMatchObject({ claims: 4, uncited: 1, invalid: 1, coverage: 0.75 });
    expect(r.citedRefs).toEqual(['PR-acme/secret#2', 'PR-acme/api#1']);
  });

  it('is idempotent and handles content without claims', () => {
    const once = verifyCitations({ a: { text: 'x', citations: ['nope'] } }, allowed);
    const twice = verifyCitations(once.content, allowed);
    expect(twice.content).toEqual({ a: { text: 'x', citations: [], flags: ['uncited'] } });
    expect(verifyCitations({ legacy: true, raw: {} }, allowed).coverage).toBeNull();
  });

  it('claims without `text` (achievement statement) are counted but carry no flags', () => {
    const r = verifyCitations({ title: 't', statement: 's', citations: ['PR-x/y#1'] }, allowed);
    expect(r.content).toEqual({ title: 't', statement: 's', citations: [] });
    expect(r).toMatchObject({ claims: 1, uncited: 1, invalid: 1 });
  });
});
