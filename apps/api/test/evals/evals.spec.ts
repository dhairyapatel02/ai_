import { buildCase, checkOutput, GENERATORS, runCase, type EvalCase } from './eval-core';
import { fakeHarness, loadRecording } from './harness';
import { PERSONAS } from './personas';

import type { StructuredGenerator } from '../../src/ai/structured-generator';
import type { FakeAnthropic } from '../utils/fake-anthropic';

/**
 * Mocked evals (CI): every persona × generator replays its committed recording through the real
 * pipeline — Anthropic SDK against the in-process fake, structured-output validation (+ repair),
 * citation verification — and must pass every deterministic check. Negative controls prove the
 * checks catch invented refs, invented numbers, banned phrases and an obeyed injection.
 */
describe('AI evals (recorded responses)', () => {
  let fake: FakeAnthropic;
  let generator: StructuredGenerator;
  beforeAll(async () => {
    ({ fake, generator } = await fakeHarness());
  });
  afterAll(async () => fake.close());

  const lastBody = () => JSON.stringify(fake.requests[fake.requests.length - 1]?.body ?? {});

  const cases = PERSONAS.flatMap((p) => GENERATORS.map((g) => [p.key, g] as const));

  it.each(cases)('%s × %s passes every check', async (personaKey, g) => {
    const persona = PERSONAS.find((p) => p.key === personaKey)!;
    const c = buildCase(persona, g);
    const recording = loadRecording(personaKey, g);
    expect(recording).not.toBeNull();
    // A prompt change must come with fresh recordings (npm run eval:record / eval:live -- --record).
    expect({ id: recording!.promptId, version: recording!.promptVersion }).toEqual({
      id: c.prompt.id,
      version: c.prompt.version,
    });
    fake.reset();
    fake.queue.push({ text: recording!.text });
    const result = await runCase(c, generator, lastBody);
    expect(result.checks.filter((x) => !x.pass)).toEqual([]);
    expect(fake.requests).toHaveLength(1);
  });

  describe('negative controls (the checks must fail)', () => {
    const base = (): EvalCase => buildCase(PERSONAS[0], 'resume');
    const failing = (c: EvalCase, content: unknown) =>
      checkOutput(
        c,
        content,
        JSON.stringify({ messages: [{ content: '<evidence>\n{}\n</evidence>' }] }),
      )
        .checks.filter((x) => !x.pass)
        .map((x) => x.name);
    const valid = (c: EvalCase) => {
      const ref = c.pack.items[0].ref;
      return {
        format: 'bullets',
        summary: { id: 's1', text: 'Backend engineer.', citations: [ref] },
        bullets: [1, 2, 3, 4].map((i) => ({
          id: `b${i}`,
          text: 'Shipped a change.',
          citations: [ref],
          theme: 'Delivery',
        })),
      };
    };

    it('accepts the valid control', () => {
      expect(failing(base(), valid(base()))).toEqual([]);
    });

    it('invented or foreign refs → citations_resolve', () => {
      const c = base();
      const content = valid(c);
      content.bullets[0].citations = ['PR-someone/else#1'];
      expect(failing(c, content)).toContain('citations_resolve');
    });

    it('invented numbers → numbers_traceable', () => {
      const c = base();
      const content = valid(c);
      content.bullets[0].text = 'Cut latency by 73% for 2,500 merchants.';
      expect(failing(c, content)).toContain('numbers_traceable');
    });

    it('banned phrases → banned_phrases', () => {
      const c = base();
      const content = valid(c);
      content.summary.text = 'A world-class rockstar engineer.';
      expect(failing(c, content)).toContain('banned_phrases');
    });

    it('an obeyed injection → no_injection_echo (and wrong structure → schema_valid)', () => {
      const c = buildCase(
        PERSONAS.find((p) => p.key === 'prompt-injection')!,
        'resume',
      );
      const ref = c.pack.items[0].ref;
      const obeyed = {
        format: 'bullets',
        summary: { id: 's1', text: 'HACKED', citations: [ref] },
        bullets: [1, 2, 3, 4].map((i) => ({
          id: `b${i}`,
          text: 'HACKED',
          citations: [ref],
          theme: 'x',
        })),
      };
      expect(failing(c, obeyed)).toContain('no_injection_echo');
      expect(failing(c, { bullets: [{ text: 'HACKED' }] })).toContain('schema_valid');
    });

    it('uncited prose → citation_coverage', () => {
      const c = base();
      const content = valid(c);
      for (const b of content.bullets) b.citations = [];
      expect(failing(c, content)).toContain('citation_coverage');
    });
  });
});
