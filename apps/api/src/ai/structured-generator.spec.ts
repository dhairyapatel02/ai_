import { z } from 'zod';

import { AiError } from './ai.errors';
import { GenerationFailure, StructuredGenerator } from './structured-generator';

import type { PromptDefinition } from '../prompts/types';
import type { AiClient } from './ai-client';

const prompt: PromptDefinition<{ n: number }, { items: string[] }, { list: string[] }> = {
  id: 'test',
  version: 3,
  model: 'default',
  feature: 'RESUME',
  maxTokens: 100,
  system: 'sys',
  buildUser: ({ n }) => `n=${n}`,
  outputSchema: z.object({ items: z.array(z.string()).max(2) }),
  toContent: (o) => ({ list: o.items }),
};

function client(texts: (string | AiError)[]) {
  const calls: { tier: string; user: string; system: string }[] = [];
  const stub = {
    configured: true,
    modelFor: (tier: string) => `model-${tier}`,
    generate: jest.fn((r: { tier: string; user: string; system: string }) => {
      calls.push(r);
      const next = texts.shift();
      if (next instanceof AiError) return Promise.reject(next);
      return Promise.resolve({
        text: next ?? '',
        model: `model-${r.tier}`,
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
        latencyMs: 5,
        attempts: 1,
      });
    }),
  };
  return { gen: new StructuredGenerator(stub as unknown as AiClient), calls };
}

describe('StructuredGenerator: validate → one repair → OUTPUT_INVALID', () => {
  it('returns validated content on the first try', async () => {
    const { gen, calls } = client(['{"items":["a"]}']);
    const r = await gen.run(prompt, { n: 1 });
    expect(r).toMatchObject({ content: { list: ['a'] }, repaired: false, model: 'model-default' });
    expect(calls).toHaveLength(1);
    expect(r.calls).toEqual([
      expect.objectContaining({
        promptId: 'test',
        promptVersion: 3,
        primary: true,
        status: 'SUCCEEDED',
      }),
    ]);
  });

  it('repairs once with the fast model and the validation errors', async () => {
    const { gen, calls } = client(['{"items":["a","b","c"]}', '{"items":["a","b"]}']);
    const r = await gen.run(prompt, { n: 1 });
    expect(r.repaired).toBe(true);
    expect(r.content.list).toEqual(['a', 'b']);
    expect(calls[1].tier).toBe('fast');
    expect(calls[1].user).toContain('<validation_errors>');
    expect(calls[1].user).toContain('items');
    expect(r.calls.map((c) => [c.promptId, c.primary])).toEqual([
      ['test', true],
      ['repair', false],
    ]);
  });

  it('throws a typed OUTPUT_INVALID after the repair fails, with both calls recorded', async () => {
    const { gen } = client(['nope', '{"items":"x"}']);
    const error = await gen.run(prompt, { n: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationFailure);
    expect((error as GenerationFailure).error).toMatchObject({
      kind: 'output_invalid',
      code: 'OUTPUT_INVALID',
    });
    expect((error as GenerationFailure).calls).toHaveLength(2);
  });

  it('records a failed primary call', async () => {
    const { gen } = client([new AiError('overloaded', 'busy')]);
    const error = (await gen.run(prompt, { n: 1 }).catch((e: unknown) => e)) as GenerationFailure;
    expect(error.calls).toEqual([
      expect.objectContaining({ status: 'FAILED', errorCode: 'UPSTREAM_UNAVAILABLE' }),
    ]);
  });
});
