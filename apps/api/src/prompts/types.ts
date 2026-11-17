import type { ModelTier } from '../ai/ai.config';
import type { AiFeature } from '@prisma/client';
import type { z } from 'zod';

/**
 * A versioned prompt (ADR-0009): `apps/api/src/prompts/<name>.v<N>.ts`. The system prompt is long
 * and stable (prompt-cached); `buildUser` renders the volatile part with untrusted data inside
 * delimited data blocks; `outputSchema` is what the model must return (structured output);
 * `toContent` turns validated model output into the stored content (ids, engine-filled sections).
 * Changing any text or schema = a new version file (the version is part of `inputHash`).
 */
export interface PromptDefinition<Input, Output, Content> {
  id: string;
  version: number;
  model: ModelTier;
  feature: AiFeature;
  maxTokens: number;
  system: string;
  buildUser: (input: Input) => string;
  outputSchema: z.ZodType<Output>;
  toContent: (output: Output, input: Input) => Content;
}

/** Assigns stable item ids (`b1`, `b2`, …) in order. */
export function withIds<T extends object>(items: T[], prefix: string): (T & { id: string })[] {
  return items.map((item, i) => ({ ...item, id: `${prefix}${i + 1}` }));
}
