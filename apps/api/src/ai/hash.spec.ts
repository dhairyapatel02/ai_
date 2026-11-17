import { canonicalJson, computeInputHash, inputsHashOf } from './hash';

const base = {
  promptId: 'resume',
  promptVersion: 1,
  model: 'model-a',
  options: { type: 'resume', role: 'backend', period: 'month:2026-10' },
  evidence: [
    { ref: 'PR-a/b#1', version: '2026-10-01T00:00:00.000Z' },
    { ref: 'PR-a/b#2', version: '2026-10-02T00:00:00.000Z' },
  ],
  metricsVersion: 'metrics@2.0.0',
  metrics: [['prs_merged', 2, 2]],
};

describe('inputHash (ADR-0009 cache key)', () => {
  it('is independent of key and evidence order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(
      computeInputHash({
        ...base,
        options: { period: 'month:2026-10', role: 'backend', type: 'resume' },
        evidence: [...base.evidence].reverse(),
      }),
    ).toBe(computeInputHash(base));
    expect(inputsHashOf({ x: 1, y: 2 })).toBe(inputsHashOf({ y: 2, x: 1 }));
  });

  it.each([
    ['prompt version', { promptVersion: 2 }],
    ['model', { model: 'model-b' }],
    ['options', { options: { ...base.options, role: 'frontend' } }],
    [
      'evidence change',
      { evidence: [{ ...base.evidence[0], version: 'later' }, base.evidence[1]] },
    ],
    ['metrics version', { metricsVersion: 'metrics@2.1.0' }],
    ['metric values', { metrics: [['prs_merged', 3, 3]] }],
  ])('changes with the %s', (_name, change) => {
    expect(computeInputHash({ ...base, ...change })).not.toBe(computeInputHash(base));
  });
});
