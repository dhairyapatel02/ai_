import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { loadModelPrices, type ModelPrice } from '../config/ai-pricing';

import type { Env } from '../config/env';

export type ModelTier = 'default' | 'fast';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Typed view of the AI settings in `config/env.ts` (model ids only come from here). */
@Injectable()
export class AiConfig {
  readonly prices: Record<string, ModelPrice>;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.prices = loadModelPrices(this.config.get('AI_PRICES_JSON', { infer: true }));
  }

  get apiKey(): string | undefined {
    return this.config.get('ANTHROPIC_API_KEY', { infer: true });
  }
  get baseUrl(): string | undefined {
    return this.config.get('ANTHROPIC_BASE_URL', { infer: true });
  }
  get configured(): boolean {
    return Boolean(this.apiKey);
  }
  model(tier: ModelTier): string {
    return tier === 'default'
      ? this.config.get('ANTHROPIC_MODEL_DEFAULT', { infer: true })
      : this.config.get('ANTHROPIC_MODEL_FAST', { infer: true });
  }
  effort(tier: ModelTier): Effort {
    return tier === 'default'
      ? this.config.get('AI_EFFORT_DEFAULT', { infer: true })
      : this.config.get('AI_EFFORT_FAST', { infer: true });
  }
  /** Server-side refusal fallback applies to the default tier only (none exists for Haiku). */
  fallbacks(tier: ModelTier): boolean {
    return tier === 'default' && this.config.get('AI_FALLBACKS_ENABLED', { infer: true });
  }
  get timeoutMs(): number {
    return this.config.get('AI_TIMEOUT_MS', { infer: true });
  }
  get quickTimeoutMs(): number {
    return this.config.get('AI_QUICK_TIMEOUT_MS', { infer: true });
  }
  get maxRetries(): number {
    return this.config.get('AI_MAX_RETRIES', { infer: true });
  }
  get retryBaseMs(): number {
    return this.config.get('AI_RETRY_BASE_MS', { infer: true });
  }
  get workerConcurrency(): number {
    return this.config.get('AI_WORKER_CONCURRENCY', { infer: true });
  }
  get streamTtlSeconds(): number {
    return this.config.get('AI_STREAM_TTL_SECONDS', { infer: true });
  }
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Cost estimate in micro-US$ (integer) from the price table; unknown models cost 0. */
export function estimateCostMicroUsd(
  prices: Record<string, ModelPrice>,
  model: string,
  usage: TokenUsage,
): number {
  const p = prices[model];
  if (!p) return 0;
  // US$ per 1M tokens → micro-US$ per token is exactly the listed price.
  return Math.round(
    usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite,
  );
}
