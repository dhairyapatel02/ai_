import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { startFakeAnthropic, type FakeAnthropic } from '../../test/utils/fake-anthropic';
import { AiClient, toAiError } from './ai-client';
import { AiError } from './ai.errors';

import type { AiConfig } from './ai.config';

function config(url: string, overrides: Partial<Record<string, unknown>> = {}): AiConfig {
  return {
    configured: true,
    apiKey: 'test-key',
    baseUrl: url,
    model: (tier: string) => (tier === 'default' ? 'model-default' : 'model-fast'),
    effort: (tier: string) => (tier === 'default' ? 'medium' : 'low'),
    fallbacks: (tier: string) => tier === 'default',
    timeoutMs: 5_000,
    quickTimeoutMs: 5_000,
    maxRetries: 2,
    retryBaseMs: 0,
    ...overrides,
  } as unknown as AiConfig;
}

const schema = z.object({ ok: z.boolean() });
const req = {
  tier: 'default' as const,
  system: 'sys',
  user: 'u',
  outputSchema: schema,
  maxTokens: 100,
};

describe('AiClient (ADR-0009)', () => {
  let fake: FakeAnthropic;
  beforeAll(async () => {
    fake = await startFakeAnthropic(() => ({ text: '{"ok":true}' }));
  });
  afterEach(() => {
    fake.reset();
  });
  afterAll(async () => fake.close());

  it('streams text, reports usage and the model, sends structured output + caching', async () => {
    const deltas: string[] = [];
    fake.queue.push({
      text: '{"ok":true}',
      chunkSize: 3,
      usage: { input: 10, output: 5, cacheRead: 7, cacheWrite: 2 },
    });
    const result = await new AiClient(config(fake.url)).generate({
      ...req,
      onText: (d) => deltas.push(d),
    });
    expect(result).toMatchObject({
      text: '{"ok":true}',
      model: 'model-default',
      attempts: 1,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 2 },
    });
    expect(deltas.join('')).toBe('{"ok":true}');
    const body = fake.requests[0].body;
    expect(body.output_config?.format?.type).toBe('json_schema');
    expect(body.output_config?.effort).toBe('medium');
    expect(body.fallbacks).toBe('default');
    expect(JSON.stringify(fake.requests[0].headers)).toContain('test-key');
  });

  it.each([
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'overloaded_error'],
  ])('retries %s and succeeds', async (status, errorType) => {
    fake.queue.push({ status, errorType });
    const result = await new AiClient(config(fake.url)).generate(req);
    expect(result.attempts).toBe(2);
    expect(fake.requests).toHaveLength(2);
  });

  it.each([
    [400, 'bad_request'],
    [401, 'bad_request'],
    [403, 'bad_request'],
  ])('does not retry %s (terminal → %s)', async (status, kind) => {
    fake.queue.push({ status });
    await expect(new AiClient(config(fake.url)).generate(req)).rejects.toMatchObject({
      kind,
      retryable: false,
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('gives up after AI_MAX_RETRIES and reports a retryable error', async () => {
    fake.queue.push({ status: 529 }, { status: 529 }, { status: 529 }, { status: 529 });
    await expect(new AiClient(config(fake.url)).generate(req)).rejects.toMatchObject({
      kind: 'overloaded',
      retryable: true,
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(fake.requests).toHaveLength(3);
  });

  it('maps refusal and max_tokens stop reasons to typed errors', async () => {
    fake.queue.push({ text: '', stopReason: 'refusal' });
    await expect(new AiClient(config(fake.url)).generate(req)).rejects.toMatchObject({
      kind: 'refused',
    });
    fake.queue.push({ text: '{"ok":', stopReason: 'max_tokens' });
    await expect(new AiClient(config(fake.url)).generate(req)).rejects.toMatchObject({
      kind: 'truncated',
      code: 'OUTPUT_INVALID',
    });
  });

  it('honours abort signals and refuses to run unconfigured', async () => {
    const controller = new AbortController();
    fake.queue.push({ text: '{"ok":true}', chunkSize: 1, delayMs: 30 });
    const run = new AiClient(config(fake.url)).generate({ ...req, signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 50);
    await expect(run).rejects.toMatchObject({ kind: 'aborted' });
    await expect(
      new AiClient(config(fake.url, { configured: false })).generate(req),
    ).rejects.toMatchObject({
      kind: 'not_configured',
    });
  });

  it('classifies connection failures as retryable and unknown errors safely', () => {
    expect(toAiError(new Anthropic.APIConnectionError({ message: 'x' }))).toMatchObject({
      kind: 'unavailable',
      retryable: true,
    });
    expect(toAiError(new Error('boom'))).toBeInstanceOf(AiError);
    expect(toAiError(new Anthropic.APIUserAbortError())).toMatchObject({
      kind: 'aborted',
      retryable: false,
    });
  });
});
