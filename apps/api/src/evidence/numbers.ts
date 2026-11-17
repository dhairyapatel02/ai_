import type { EvidencePack } from './evidence-pack';

/**
 * Numeric traceability (KPI §8, P08 evals): every number written in prose must appear in the
 * supplied metrics or evidence. Numbers are compared as normalised decimal strings.
 */
const NUMBER = /(?<![A-Za-z])\d+(?:[.,]\d+)?/g;

export function normaliseNumber(raw: string): string {
  const n = Number(raw.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? String(n) : raw;
}

export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((m) => normaliseNumber(m[0]));
}

/** Every number the model may legitimately write for this pack. */
export function allowedNumbers(pack: EvidencePack): Set<string> {
  const allowed = new Set<string>();
  const add = (v: number | string | null | undefined) => {
    if (v === null || v === undefined) return;
    for (const n of numbersIn(String(v))) allowed.add(n);
  };
  for (const m of pack.metrics) {
    if (m.value === null) continue;
    add(m.display);
    add(m.value);
    add(Math.round(m.value));
    add(Math.round(m.value * 10) / 10);
    if (m.unit === 'ratio') {
      add(Math.round(m.value * 100));
      add(Math.round(m.value * 1000) / 10);
    }
    add(m.n);
  }
  for (const v of Object.values(pack.counts)) add(v);
  for (const item of pack.items) {
    add(item.title);
    add(item.promptRef);
    for (const v of Object.values(item.facts)) add(Array.isArray(v) ? v.join(' ') : (v as string | number | null));
  }
  if (pack.score) {
    add(pack.score.overall);
    for (const d of pack.score.dimensions) add(d.score);
  }
  add(pack.period.label);
  add(pack.period.startDate);
  add(pack.period.endDate);
  return allowed;
}

/** Numbers in `text` that are not traceable to the pack. */
export function untracedNumbers(text: string, allowed: Set<string>): string[] {
  return numbersIn(text).filter((n) => !allowed.has(n));
}
