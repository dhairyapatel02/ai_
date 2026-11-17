/**
 * Post-generation citation verification (ADR-0009, F-45). Every object with a `citations` array is
 * a claim. Citations are mapped from the refs the model saw (aliases for redacted repos) to real
 * refs; refs outside the evidence set — i.e. not one of the user's own records selected for this
 * document — are removed and the claim is flagged `invalid_citation`; claims left without a valid
 * citation are flagged `uncited`. Pure and idempotent (re-run on user edits).
 */
export interface VerificationResult<T> {
  content: T;
  /** Claims with ≥ 1 valid citation ÷ claims (null when there are no claims). */
  coverage: number | null;
  claims: number;
  uncited: number;
  invalid: number;
  /** Real refs cited anywhere in the content (deduplicated, in order of appearance). */
  citedRefs: string[];
}

type Json = unknown;

export function verifyCitations<T>(content: T, allowed: ReadonlyMap<string, string>): VerificationResult<T> {
  let claims = 0;
  let cited = 0;
  let uncited = 0;
  let invalid = 0;
  const citedRefs = new Set<string>();

  const visit = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const obj = node as Record<string, Json>;
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(obj)) out[key] = visit(value);
    if (!Array.isArray(obj.citations)) return out;

    claims++;
    const valid: string[] = [];
    let hadInvalid = false;
    for (const raw of obj.citations) {
      const real = typeof raw === 'string' ? allowed.get(raw.trim()) : undefined;
      if (real === undefined) hadInvalid = true;
      else if (!valid.includes(real)) valid.push(real);
    }
    out.citations = valid;
    valid.forEach((ref) => citedRefs.add(ref));
    const flags: string[] = [];
    if (hadInvalid) {
      invalid++;
      flags.push('invalid_citation');
    }
    if (valid.length === 0) {
      uncited++;
      flags.push('uncited');
    } else {
      cited++;
    }
    // Only claim items (with `text`) carry flags in the content schemas.
    if (typeof obj.text === 'string') {
      if (flags.length > 0) out.flags = flags;
      else delete out.flags;
    }
    return out;
  };

  const verified = visit(content) as T;
  return {
    content: verified,
    coverage: claims === 0 ? null : cited / claims,
    claims,
    uncited,
    invalid,
    citedRefs: [...citedRefs],
  };
}

/** Allowed-ref map from a pack: model-facing ref → real ref, and real ref → itself. */
export function allowedRefs(items: { ref: string; promptRef: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.ref, item.ref);
    map.set(item.promptRef, item.ref);
  }
  return map;
}
