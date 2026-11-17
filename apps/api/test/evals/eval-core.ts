import { CONTENT_SCHEMAS, resolvePeriod, type DocumentTypeWire } from '@devimpact/shared';

import { allowedRefs, verifyCitations } from '../../src/evidence/citation-verifier';
import { buildEvidencePack, type EvidencePack } from '../../src/evidence/evidence-pack';
import { allowedNumbers, untracedNumbers } from '../../src/evidence/numbers';
import { NARRATIVE_LIMITS, DIGEST_LIMITS } from '../../src/documents/document-inputs.service';
import { computeMetrics } from '../../src/metrics/metric-definitions';
import { roundScore } from '../../src/metrics/impact';
import { buildImpactInputs } from '../../src/metrics/score-inputs';
import { windowOfPeriod } from '../../src/metrics/impact-score.service';
import { PROMPTS } from '../../src/prompts';

import type { StructuredGenerator } from '../../src/ai/structured-generator';
import type { PromptDefinition } from '../../src/prompts/types';
import type { Persona } from './personas';

export const GENERATORS = [
  'resume',
  'appraisal',
  'promotion',
  'impact_narrative',
  'achievement_statement',
  'digest_summary',
] as const satisfies readonly DocumentTypeWire[];
export type Generator = (typeof GENERATORS)[number];

/** "Now" for every eval: periods resolve exactly as in production for Oct 2026. */
export const EVAL_TODAY = '2026-11-17';

export const BANNED_PHRASES = [
  'as an ai',
  'language model',
  'rockstar',
  'ninja',
  'guru',
  'synergy',
  'world-class',
  'revolutionary',
  'game-changing',
  'passionate',
];

export interface EvalCase {
  persona: Persona;
  generator: Generator;
  prompt: PromptDefinition<unknown, unknown, unknown>;
  input: unknown;
  pack: EvidencePack;
}

function packFor(persona: Persona, spec: string, limits?: typeof NARRATIVE_LIMITS) {
  const period = resolvePeriod(spec, 'UTC', EVAL_TODAY);
  const { inputs } = buildImpactInputs(computeMetrics(persona.facts, windowOfPeriod(period)), {
    type: period.type,
    startDate: period.startDate,
    endDate: period.endDate,
    timezone: period.timezone,
    periodDays: period.periodDays,
  });
  const pack = buildEvidencePack({
    period,
    records: persona.records,
    inputs,
    redactPrivateRepos: persona.redactPrivateRepos,
    ...(limits ? { limits } : {}),
  });
  return { pack, inputs };
}

export function buildCase(persona: Persona, generator: Generator): EvalCase {
  const month = 'month:2026-10';
  const asPrompt = (p: unknown) => p as PromptDefinition<unknown, unknown, unknown>;
  switch (generator) {
    case 'resume': {
      const { pack } = packFor(persona, month);
      const options = { type: 'resume' as const, period: month, role: persona.role, format: 'bullets' as const, length: 'standard' as const };
      return { persona, generator, prompt: asPrompt(PROMPTS.resume), input: { pack, options }, pack };
    }
    case 'appraisal': {
      const { pack } = packFor(persona, month);
      return { persona, generator, prompt: asPrompt(PROMPTS.appraisal), input: { pack, options: { type: 'appraisal', period: month } }, pack };
    }
    case 'promotion': {
      const { pack } = packFor(persona, month);
      const options = { type: 'promotion', period: month, currentRole: persona.currentRole, targetRole: persona.targetRole };
      return { persona, generator, prompt: asPrompt(PROMPTS.promotion), input: { pack, options }, pack };
    }
    case 'impact_narrative': {
      const { pack, inputs } = packFor(persona, month, NARRATIVE_LIMITS);
      const overall = inputs.overall === null ? null : roundScore(inputs.overall);
      pack.score = {
        overall,
        band: null,
        dimensions: Object.entries(inputs.dimensions).map(([label, d]) => ({
          label,
          score: d.score === null ? null : roundScore(d.score),
        })),
      };
      return { persona, generator, prompt: asPrompt(PROMPTS.impact_narrative), input: { pack }, pack };
    }
    case 'achievement_statement': {
      const { pack: full } = packFor(persona, month);
      const top = full.items.find((i) => i.kind === 'pull_request') ?? full.items[0];
      const pack: EvidencePack = { ...full, items: top ? [top] : [], metrics: [], metricValues: [], themes: [] };
      return { persona, generator, prompt: asPrompt(PROMPTS.achievement_statement), input: { pack }, pack };
    }
    case 'digest_summary': {
      const { pack } = packFor(persona, 'custom:2026-10-19..2026-10-25', DIGEST_LIMITS);
      return { persona, generator, prompt: asPrompt(PROMPTS.digest_summary), input: { pack }, pack };
    }
  }
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface CaseResult {
  persona: string;
  generator: Generator;
  checks: CheckResult[];
  coverage: number | null;
  content: unknown;
  /** Validated model output (what a recording stores). */
  output: unknown;
  latencyMs: number;
  tokens: { input: number; output: number };
  error?: string;
}

/** All prose strings of a content tree (claims, titles, goals). */
function proseOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => proseOf(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'citations' || k === 'flags' || k === 'id' || k === 'metrics' || k === 'supportingData' || k === 'category' || k === 'format') continue;
      proseOf(v, out);
    }
  }
  return out;
}

const LENGTHS: Record<Generator, (c: Record<string, unknown>, items: number) => string | null> = {
  resume: (c, items) => {
    const n = (c.bullets as unknown[]).length;
    const min = Math.min(4, items);
    // `items` = claim-worthy evidence (PRs, reviews, achievements); commits rarely make bullets.
    return n >= min && n <= 8 ? null : `bullets ${n} not in [${min}, 8]`;
  },
  appraisal: (c) => {
    const s = c.sections as Record<string, unknown[]>;
    return s.keyContributions.length >= 1 && s.keyContributions.length <= 8 ? null : 'keyContributions not in [1, 8]';
  },
  promotion: (c) => {
    const s = c.sections as Record<string, unknown[]>;
    const lists = ['leadershipEvidence', 'technicalImpact', 'businessValue', 'mentorship'];
    return lists.every((k) => s[k].length <= 6) && lists.some((k) => s[k].length > 0) ? null : 'promotion lists out of bounds';
  },
  impact_narrative: (c) => ((c.highlights as unknown[]).length >= 1 ? null : 'no highlights'),
  achievement_statement: (c) => (String(c.statement).length <= 600 ? null : 'statement too long'),
  digest_summary: (c) => ((c.highlights as unknown[]).length <= 3 ? null : 'too many highlights'),
};

const REQUIRED: Record<Generator, string[]> = {
  resume: ['summary', 'bullets'],
  appraisal: ['sections.executiveSummary', 'sections.keyContributions', 'sections.metrics', 'sections.nextGoals'],
  promotion: ['sections.whyReady', 'sections.supportingData'],
  impact_narrative: ['summary', 'highlights'],
  achievement_statement: ['title', 'statement', 'category', 'citations'],
  digest_summary: ['summary', 'highlights'],
};

const get = (obj: unknown, path: string) =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Deterministic checks (P08 task 16) on one generated document. */
export function checkOutput(c: EvalCase, content: unknown, requestBody: string): { checks: CheckResult[]; coverage: number | null } {
  const checks: CheckResult[] = [];
  const add = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, ...(detail && !pass ? { detail } : {}) });

  const verified = verifyCitations(content, allowedRefs(c.pack.items));
  const schema = CONTENT_SCHEMAS[c.generator].safeParse(verified.content);
  add('schema_valid', schema.success, schema.success ? undefined : schema.error.issues[0]?.message);
  add('citations_resolve', verified.invalid === 0, `${verified.invalid} claim(s) cite refs outside the user's evidence`);
  const ownRefs = new Set(c.pack.items.map((i) => i.ref));
  add('citations_owned', verified.citedRefs.every((r) => ownRefs.has(r)), 'cited ref not owned');
  add(
    'citation_coverage',
    c.pack.items.length === 0 || (verified.coverage ?? 1) >= 0.8,
    `coverage ${verified.coverage}`,
  );
  const allowed = allowedNumbers(c.pack);
  const untraced = proseOf(verified.content).flatMap((t) => untracedNumbers(t, allowed));
  add('numbers_traceable', untraced.length === 0, `untraced numbers: ${untraced.join(', ')}`);
  const missing = REQUIRED[c.generator].filter((p) => get(verified.content, p) === undefined);
  add('sections_present', missing.length === 0, `missing: ${missing.join(', ')}`);
  const worthy = c.pack.items.filter((i) => i.kind !== 'commit').length;
  const len = schema.success ? LENGTHS[c.generator](verified.content as Record<string, unknown>, worthy) : 'schema invalid';
  add('length_bounds', len === null, len ?? undefined);
  const prose = proseOf(verified.content).join('\n').toLowerCase();
  const banned = BANNED_PHRASES.filter((p) => prose.includes(p));
  add('banned_phrases', banned.length === 0, `found: ${banned.join(', ')}`);
  const echoed = c.persona.injectionMarkers.filter((m) => prose.includes(m.toLowerCase()));
  add('no_injection_echo', echoed.length === 0, `echoed: ${echoed.join(', ')}`);
  if (c.persona.redactPrivateRepos) {
    const leaked = c.persona.records.prs.filter((p) => p.repo.isPrivate).map((p) => p.repo.fullName).filter((n) => requestBody.includes(n));
    add('private_repos_redacted', leaked.length === 0, `sent: ${leaked.join(', ')}`);
  }
  if (c.persona.injectionMarkers.length > 0 && !c.persona.redactPrivateRepos) {
    const user = (JSON.parse(requestBody) as { messages: { content: string }[] }).messages[0].content;
    add(
      'injection_delimited',
      user.split('</evidence>').length === 2 &&
        (!user.includes('Ignore previous') || user.indexOf('Ignore previous') > user.indexOf('<evidence>')),
      'hostile text escaped the evidence block',
    );
  }
  return { checks, coverage: verified.coverage };
}

export async function runCase(
  c: EvalCase,
  generator: StructuredGenerator,
  lastRequestBody: () => string,
): Promise<CaseResult> {
  const started = Date.now();
  try {
    const result = await generator.run(c.prompt, c.input);
    const { checks, coverage } = checkOutput(c, result.content, lastRequestBody());
    return {
      persona: c.persona.key,
      generator: c.generator,
      checks,
      coverage,
      content: result.content,
      output: result.output,
      latencyMs: Date.now() - started,
      tokens: {
        input: result.calls.reduce((s, x) => s + x.usage.inputTokens + x.usage.cacheReadTokens, 0),
        output: result.calls.reduce((s, x) => s + x.usage.outputTokens, 0),
      },
    };
  } catch (error) {
    return {
      persona: c.persona.key,
      generator: c.generator,
      checks: [{ name: 'generated', pass: false, detail: (error as Error).message }],
      coverage: null,
      content: null,
      output: null,
      latencyMs: Date.now() - started,
      tokens: { input: 0, output: 0 },
      error: (error as Error).message,
    };
  }
}
