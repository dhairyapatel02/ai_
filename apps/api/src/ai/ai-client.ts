import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Injectable, Logger } from '@nestjs/common';

import { AiConfig, ZERO_USAGE, type ModelTier, type TokenUsage } from './ai.config';
import { AiError } from './ai.errors';

import type { z } from 'zod';

export interface AiCallRequest {
  tier: ModelTier;
  /** Long, stable instructions — sent first with `cache_control` (prompt caching). */
  system: string;
  /** Volatile part: options + delimited evidence. */
  user: string;
  /** Zod schema → JSON schema for `output_config.format` (structured output). */
  outputSchema: z.ZodType;
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Text deltas as they stream (the JSON being written). */
  onText?: (delta: string) => void;
}

export interface AiCallResult {
  text: string;
  /** Model that produced the answer (the fallback model when a refusal fallback ran). */
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  attempts: number;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_RETRY_DELAY_MS = 30_000;

/** Maps SDK errors to typed `AiError`s (retry classification, AI-04). */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AiError('aborted', 'Request aborted', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('unavailable', 'Anthropic request timed out', { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('unavailable', 'Could not reach Anthropic', { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryAfter = Number(error.headers?.get?.('retry-after'));
    const opts = {
      status,
      cause: error,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    };
    if (status === undefined) {
      // Mid-stream `error` events carry no HTTP status; classify by error type.
      const type = (error.error as { error?: { type?: string } } | undefined)?.error?.type;
      if (type === 'rate_limit_error') return new AiError('rate_limited', 'Anthropic rate limit', opts);
      if (type === 'overloaded_error') return new AiError('overloaded', 'Anthropic is overloaded', opts);
      if (type === 'invalid_request_error' || type === 'authentication_error' || type === 'permission_error') {
        return new AiError('bad_request', `Anthropic rejected the stream (${type})`, opts);
      }
      return new AiError('unavailable', 'Anthropic stream error', opts);
    }
    if (status === 429) return new AiError('rate_limited', 'Anthropic rate limit', opts);
    if (status === 529) return new AiError('overloaded', 'Anthropic is overloaded', opts);
    if (status >= 500) return new AiError('unavailable', 'Anthropic server error', opts);
    // 408/409 are retryable per the SDK defaults.
    if (status === 408 || status === 409) {
      return new AiError('unavailable', 'Anthropic request conflict/timeout', opts);
    }
    return new AiError('bad_request', `Anthropic rejected the request (${status})`, opts);
  }
  return new AiError('unavailable', 'Unexpected AI client failure', { cause: error });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('aborted', 'Request aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiError('aborted', 'Request aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The one wrapper around `@anthropic-ai/sdk` (ADR-0009): model from config, adaptive thinking
 * with explicit effort, structured output via `output_config.format`, prompt caching of the system
 * prompt, streaming (`messages.stream` + `finalMessage`), refusal handling with the optional
 * server-side fallback, timeouts, abort, usage capture and retries **only** for retryable errors
 * (429 / 5xx / overloaded / connection) with exponential backoff + full jitter — and only before
 * any text was streamed, so a retry never duplicates streamed output.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: AiConfig) {}

  get configured(): boolean {
    return this.config.configured;
  }

  modelFor(tier: ModelTier): string {
    return this.config.model(tier);
  }

  private sdk(): Anthropic {
    if (!this.config.configured) {
      throw new AiError('not_configured', 'ANTHROPIC_API_KEY is not set');
    }
    this.client ??= new Anthropic({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      // Our own retry loop (below) owns retries so they can be classified and stay pre-stream.
      maxRetries: 0,
      timeout: this.config.timeoutMs,
    });
    return this.client;
  }

  async generate(request: AiCallRequest): Promise<AiCallResult> {
    const sdk = this.sdk();
    const started = Date.now();
    const maxAttempts = this.config.maxRetries + 1;
    for (let attempt = 1; ; attempt++) {
      let streamed = false;
      try {
        const result = await this.once(sdk, request, () => {
          streamed = true;
        });
        return { ...result, latencyMs: Date.now() - started, attempts: attempt };
      } catch (raw) {
        const error = toAiError(raw);
        if (request.signal?.aborted) throw new AiError('aborted', 'Request aborted');
        if (!error.retryable || streamed || attempt >= maxAttempts) throw error;
        const base = this.config.retryBaseMs * 2 ** (attempt - 1);
        const hinted = (error.options.retryAfterSeconds ?? 0) * 1000;
        const delay = Math.min(MAX_RETRY_DELAY_MS, Math.max(hinted, Math.random() * base));
        this.logger.warn(
          { kind: error.kind, status: error.options.status, attempt, delayMs: Math.round(delay) },
          'Retrying Anthropic call',
        );
        await sleep(delay, request.signal);
      }
    }
  }

  private async once(
    sdk: Anthropic,
    request: AiCallRequest,
    markStreamed: () => void,
  ): Promise<Omit<AiCallResult, 'latencyMs' | 'attempts'>> {
    const model = this.config.model(request.tier);
    const format = zodOutputFormat(request.outputSchema);
    const fallbacks = this.config.fallbacks(request.tier);
    const stream = sdk.beta.messages.stream(
      {
        model,
        max_tokens: request.maxTokens,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.user }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: this.config.effort(request.tier),
          format: { type: 'json_schema', schema: format.schema },
        },
        ...(fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      },
      {
        ...(request.signal ? { signal: request.signal } : {}),
        timeout: request.timeoutMs ?? this.config.timeoutMs,
      },
    );
    stream.on('text', (delta) => {
      markStreamed();
      request.onText?.(delta);
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      const category = (message as { stop_details?: { category?: string | null } | null })
        .stop_details?.category;
      throw new AiError('refused', `Model refused (category ${category ?? 'unknown'})`);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new AiError('truncated', 'Model output hit max_tokens');
    }
    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const u = message.usage;
    return {
      text,
      model: message.model || model,
      usage: u
        ? {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          }
        : ZERO_USAGE,
    };
  }
}
