import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively (stable across key order). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * `inputHash` (ADR-0009) = sha256(promptId, promptVersion, model, canonical(options),
 * sorted(evidence ref + version), metricsVersion, metric values). Same hash → same document.
 */
export function computeInputHash(parts: {
  promptId: string;
  promptVersion: number;
  model: string;
  options: unknown;
  evidence: { ref: string; version: string }[];
  metricsVersion: string;
  metrics: unknown;
}): string {
  const evidence = parts.evidence.map((e) => `${e.ref}|${e.version}`).sort();
  return sha256(
    canonicalJson({
      p: `${parts.promptId}@${parts.promptVersion}`,
      m: parts.model,
      o: parts.options,
      e: evidence,
      v: parts.metricsVersion,
      x: parts.metrics,
    }),
  );
}

/** Hash of an impact score's stored inputs (impact narratives are cached per inputs, KPI §8). */
export const inputsHashOf = (inputs: unknown) => sha256(canonicalJson(inputs));
