import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { AiClient } from '../../src/ai/ai-client';
import { StructuredGenerator } from '../../src/ai/structured-generator';
import { startFakeAnthropic, type FakeAnthropic } from '../utils/fake-anthropic';

import type { AiConfig } from '../../src/ai/ai.config';
import type { Generator } from './eval-core';

export const RECORDINGS_DIR = path.join(__dirname, 'recordings');

export interface Recording {
  persona: string;
  generator: Generator;
  promptId: string;
  promptVersion: number;
  model: string;
  source: 'synthetic' | 'live';
  recordedAt: string;
  text: string;
}

export const recordingPath = (persona: string, generator: string) =>
  path.join(RECORDINGS_DIR, `${persona}.${generator}.json`);

export function loadRecording(persona: string, generator: string): Recording | null {
  const file = recordingPath(persona, generator);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Recording) : null;
}

/** Model ids for evals (tests may name models; services never do). */
export const EVAL_MODELS = {
  default: process.env.ANTHROPIC_MODEL_DEFAULT ?? 'claude-opus-5-5',
  fast: process.env.ANTHROPIC_MODEL_FAST ?? 'claude-haiku-5-5',
};

export function evalGenerator(opts: { baseUrl?: string; apiKey: string; fallbacks: boolean }): StructuredGenerator {
  const config = {
    configured: true,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    model: (tier: 'default' | 'fast') => EVAL_MODELS[tier],
    effort: (tier: 'default' | 'fast') => (tier === 'default' ? 'medium' : 'low'),
    fallbacks: (tier: 'default' | 'fast') => opts.fallbacks && tier === 'default',
    timeoutMs: 300_000,
    quickTimeoutMs: 60_000,
    maxRetries: 2,
    retryBaseMs: opts.baseUrl ? 0 : 2_000,
  } as unknown as AiConfig;
  return new StructuredGenerator(new AiClient(config));
}

/** A fake Messages API plus a generator wired to it (CI mode). */
export async function fakeHarness(): Promise<{ fake: FakeAnthropic; generator: StructuredGenerator }> {
  const fake = await startFakeAnthropic();
  return { fake, generator: evalGenerator({ baseUrl: fake.url, apiKey: 'eval-key', fallbacks: true }) };
}
