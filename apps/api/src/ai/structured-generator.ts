import { Injectable } from '@nestjs/common';

import { REPAIR_PROMPT } from '../prompts';
import { AiClient, type AiCallResult } from './ai-client';
import { ZERO_USAGE, type TokenUsage } from './ai.config';
import { AiError } from './ai.errors';

import type { PromptDefinition } from '../prompts/types';
import type { z } from 'zod';

/** One Anthropic call as recorded in `AiUsage`. */
export interface AiCallRecord {
  promptId: string;
  promptVersion: number;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  /** The generation call itself (false for the repair call). Only primaries count to quota. */
  primary: boolean;
  errorCode: string | null;
}

/** A failed generation with the calls made so far (for usage accounting). */
export class GenerationFailure extends Error {
  constructor(
    readonly error: AiError,
    readonly calls: AiCallRecord[],
  ) {
    super(error.message);
    this.name = 'GenerationFailure';
  }
}

export interface GenerationResult<Output, Content> {
  output: Output;
  content: Content;
  model: string;
  calls: AiCallRecord[];
  repaired: boolean;
}

function validationErrors(schema: z.ZodType, text: string): { value?: unknown; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ['The output is not valid JSON.'] };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { value: parsed.data, errors: [] };
  return {
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

/**
 * Runs a versioned prompt with structured output (ADR-0009): call → JSON.parse → Zod validate →
 * on failure exactly one repair call (fast model, validation errors as data) → typed
 * `OUTPUT_INVALID`. Records every call for `AiUsage`.
 */
@Injectable()
export class StructuredGenerator {
  constructor(private readonly client: AiClient) {}

  get configured(): boolean {
    return this.client.configured;
  }

  modelFor(prompt: { model: 'default' | 'fast' }): string {
    return this.client.modelFor(prompt.model);
  }

  async run<Input, Output, Content>(
    prompt: PromptDefinition<Input, Output, Content>,
    input: Input,
    opts: { signal?: AbortSignal; onText?: (delta: string) => void; timeoutMs?: number } = {},
  ): Promise<GenerationResult<Output, Content>> {
    const calls: AiCallRecord[] = [];
    const call = async (
      meta: { id: string; version: number; tier: 'default' | 'fast'; maxTokens: number; primary: boolean },
      system: string,
      user: string,
      onText?: (delta: string) => void,
    ): Promise<AiCallResult> => {
      const started = Date.now();
      try {
        const result = await this.client.generate({
          tier: meta.tier,
          system,
          user,
          outputSchema: prompt.outputSchema,
          maxTokens: meta.maxTokens,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
          ...(onText ? { onText } : {}),
        });
        calls.push({
          promptId: meta.id,
          promptVersion: meta.version,
          model: result.model,
          usage: result.usage,
          latencyMs: result.latencyMs,
          status: 'SUCCEEDED',
          primary: meta.primary,
          errorCode: null,
        });
        return result;
      } catch (raw) {
        const error = raw instanceof AiError ? raw : new AiError('unavailable', 'AI call failed');
        calls.push({
          promptId: meta.id,
          promptVersion: meta.version,
          model: this.client.modelFor(meta.tier),
          usage: ZERO_USAGE,
          latencyMs: Date.now() - started,
          status: error.kind === 'aborted' ? 'CANCELLED' : 'FAILED',
          primary: meta.primary,
          errorCode: error.code,
        });
        throw new GenerationFailure(error, calls);
      }
    };

    const first = await call(
      {
        id: prompt.id,
        version: prompt.version,
        tier: prompt.model,
        maxTokens: prompt.maxTokens,
        primary: true,
      },
      prompt.system,
      prompt.buildUser(input),
      opts.onText,
    );
    let checked = validationErrors(prompt.outputSchema, first.text);
    let repaired = false;
    if (checked.errors.length > 0) {
      const second = await call(
        {
          id: REPAIR_PROMPT.id,
          version: REPAIR_PROMPT.version,
          tier: REPAIR_PROMPT.model,
          maxTokens: REPAIR_PROMPT.maxTokens,
          primary: false,
        },
        REPAIR_PROMPT.system,
        REPAIR_PROMPT.buildUser(first.text, checked.errors),
      );
      checked = validationErrors(prompt.outputSchema, second.text);
      repaired = true;
      if (checked.errors.length > 0) {
        throw new GenerationFailure(
          new AiError('output_invalid', `Output invalid after repair: ${checked.errors[0]}`),
          calls,
        );
      }
    }
    const output = checked.value as Output;
    return {
      output,
      content: prompt.toContent(output, input),
      model: first.model,
      calls,
      repaired,
    };
  }
}
