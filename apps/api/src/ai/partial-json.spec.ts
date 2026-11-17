import fc from 'fast-check';

import { PartialJsonSections } from './partial-json';

function scan(chunks: string[]) {
  const sections: [string, number, unknown][] = [];
  const deltas: Record<string, string> = {};
  const p = new PartialJsonSections({
    onSection: (k, i, v) => sections.push([k, i, v]),
    onDelta: (k, t) => {
      deltas[k] = (deltas[k] ?? '') + t;
    },
  });
  chunks.forEach((c) => p.push(c));
  return { sections, deltas };
}

const doc = {
  summary: { text: 'Hi "there" \\ é \n ✓', citations: ['PR-a/b#1'] },
  bullets: [
    { text: 'One', citations: [] },
    { text: 'Two {[,]}', citations: ['C-a/b@abcdef0'] },
  ],
  count: 3,
  flag: true,
  goals: ['a', 'b'],
};
const text = JSON.stringify(doc, null, 1);

describe('PartialJsonSections (streamed structured output)', () => {
  it('reports top-level values and each element of top-level arrays, in order', () => {
    const { sections, deltas } = scan([text]);
    expect(sections).toEqual([
      ['summary', 0, doc.summary],
      ['bullets', 0, doc.bullets[0]],
      ['bullets', 1, doc.bullets[1]],
      ['count', 0, 3],
      ['flag', 0, true],
      ['goals', 0, 'a'],
      ['goals', 1, 'b'],
    ]);
    expect(deltas.summary).toContain('Hi "there" \\ é \n ✓');
    expect(deltas.bullets).toBe('OneTwo {[,]}C-a/b@abcdef0');
  });

  it('gives the same result for any chunking (escapes and \\u sequences split across chunks)', () => {
    const escaped = JSON.stringify({ a: 'x\u00e9\\"y', b: [1, 'z'] }).replace('é', '\\u00e9');
    const whole = scan([escaped]);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: escaped.length }), { maxLength: 8 }), (cuts) => {
        const points = [...new Set(cuts)].sort((x, y) => x - y);
        const chunks: string[] = [];
        let last = 0;
        for (const p of points) {
          chunks.push(escaped.slice(last, p));
          last = p;
        }
        chunks.push(escaped.slice(last));
        expect(scan(chunks)).toEqual(whole);
      }),
    );
    expect(whole.sections).toEqual([
      ['a', 0, 'xé\\"y'],
      ['b', 0, 1],
      ['b', 1, 'z'],
    ]);
  });

  it('ignores garbage without throwing', () => {
    expect(() => scan(['not json', '{"a": [1,, }}}'])).not.toThrow();
  });
});
