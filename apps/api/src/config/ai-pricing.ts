import { z } from 'zod';

/**
 * Cost-estimate price table, US$ per 1M tokens (claude-api skill, cached 2026-11-03). Model ids
 * appear only in `src/config/` (P08 acceptance). Unknown models cost 0 in estimates; override or
 * extend with `AI_PRICES_JSON`. Estimates only — billing is Anthropic's invoice.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const PriceOverride = z.record(
  z.string().min(1),
  z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
  }),
);

/** Default table merged with `AI_PRICES_JSON` (invalid JSON fails startup with a clear error). */
export function loadModelPrices(json: string | undefined): Record<string, ModelPrice> {
  if (!json) return { ...DEFAULT_MODEL_PRICES };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('AI_PRICES_JSON is not valid JSON');
  }
  const parsed = PriceOverride.safeParse(raw);
  if (!parsed.success) throw new Error(`AI_PRICES_JSON is invalid: ${parsed.error.message}`);
  const out = { ...DEFAULT_MODEL_PRICES };
  for (const [model, p] of Object.entries(parsed.data)) {
    out[model] = {
      input: p.input,
      output: p.output,
      cacheRead: p.cacheRead ?? p.input / 10,
      cacheWrite: p.cacheWrite ?? p.input * 1.25,
    };
  }
  return out;
}
