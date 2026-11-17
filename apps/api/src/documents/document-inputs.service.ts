import {
  AppraisalOptions,
  DocumentOptions,
  METRICS_VERSION,
  PromotionOptions,
  ResumeOptions,
  addDays,
  impactBand,
  type DocumentTypeWire,
  type ResolvedPeriod,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { computeInputHash, inputsHashOf } from '../ai/hash';
import { StructuredGenerator, type GenerationResult } from '../ai/structured-generator';
import { AppException } from '../common/app-exception';
import { EvidenceBuilder } from '../evidence/evidence-builder.service';
import { roundScore } from '../metrics/impact';
import { PROMPTS } from '../prompts';

import type { EvidencePack, PackLimits } from '../evidence/evidence-pack';
import type { ImpactInputs } from '../metrics/score-inputs';
import type { PromptDefinition } from '../prompts/types';
import type { AiFeature } from '@prisma/client';

/** Smaller packs for quick actions (fast model, ≤ 20 s). */
export const NARRATIVE_LIMITS: PackLimits = { prs: 15, reviews: 8, commits: 5, achievements: 10 };
export const DIGEST_LIMITS: PackLimits = { prs: 10, reviews: 5, commits: 5, achievements: 5 };

export const ImpactNarrativeOptions = z.object({
  period: z.string(),
  scoreVersion: z.string(),
  inputsHash: z.string(),
});
export const AchievementOptions = z.object({
  source: z.object({ kind: z.enum(['pull_request', 'commit']), id: z.string() }),
});
export const DigestOptions = z.object({ weekStart: z.iso.date() });

export interface PreparedGeneration {
  type: DocumentTypeWire;
  prompt: { id: string; version: number; model: 'default' | 'fast'; feature: AiFeature };
  pack: EvidencePack;
  period: ResolvedPeriod | null;
  timezone: string;
  /** Normalised options as stored on the document (period spec resolved). */
  options: Record<string, unknown>;
  title: string;
  inputHash: string;
  model: string;
  /** Runs the prompt for this input (generics captured). */
  run: (
    generator: StructuredGenerator,
    opts: { signal?: AbortSignal; onText?: (delta: string) => void; timeoutMs?: number },
  ) => Promise<GenerationResult<unknown, unknown>>;
}

const truncate = (text: string, max = 200) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Turns `(type, options)` into everything a generation needs: resolved period, deterministic
 * evidence pack, prompt + input, title and `inputHash`. Used by the API (cache check, creation)
 * and by the worker (generation), so both see the same evidence.
 */
@Injectable()
export class DocumentInputs {
  constructor(
    private readonly evidence: EvidenceBuilder,
    private readonly generator: StructuredGenerator,
  ) {}

  private finish<I, O, C>(
    prompt: PromptDefinition<I, O, C>,
    input: I,
    rest: Omit<PreparedGeneration, 'prompt' | 'inputHash' | 'model' | 'run'>,
  ): PreparedGeneration {
    const model = this.generator.modelFor(prompt);
    const inputHash = computeInputHash({
      promptId: prompt.id,
      promptVersion: prompt.version,
      model,
      options: rest.options,
      evidence: rest.pack.items.map((i) => ({ ref: i.ref, version: i.version })),
      metricsVersion: METRICS_VERSION,
      metrics: rest.pack.metrics.map((m) => [m.key, m.value, m.n]),
    });
    return {
      ...rest,
      prompt: {
        id: prompt.id,
        version: prompt.version,
        model: prompt.model,
        feature: prompt.feature,
      },
      inputHash,
      model,
      run: (generator, opts) => generator.run(prompt, input, opts),
    };
  }

  async prepare(
    userId: string,
    type: DocumentTypeWire,
    rawOptions: unknown,
    extra: { section?: string } = {},
  ): Promise<PreparedGeneration> {
    switch (type) {
      case 'resume':
      case 'appraisal':
      case 'promotion':
        return this.prepareStudio(userId, rawOptions, extra.section);
      case 'impact_narrative': {
        const options = ImpactNarrativeOptions.parse(rawOptions);
        return this.prepareNarrative(userId, options.period);
      }
      case 'achievement_statement':
        return this.prepareAchievement(userId, AchievementOptions.parse(rawOptions).source);
      case 'digest_summary':
        return this.prepareDigest(userId, DigestOptions.parse(rawOptions).weekStart);
    }
  }

  async prepareStudio(
    userId: string,
    rawOptions: unknown,
    section?: string,
  ): Promise<PreparedGeneration> {
    const parsed = DocumentOptions.safeParse(rawOptions);
    if (!parsed.success) {
      throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
        issues: parsed.error.issues.map((i) => ({
          path: ['body', ...i.path.map(String)].join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const options = parsed.data;
    const ctx = await this.evidence.context(
      userId,
      options.period,
      options.type === 'promotion' ? 'last12months' : 'default',
    );
    const pack = await this.evidence.forPeriod(userId, ctx);
    const stored = { ...options, period: ctx.period.spec };
    const base = { pack, period: ctx.period, timezone: ctx.timezone, options: stored };
    switch (options.type) {
      case 'resume': {
        const o = ResumeOptions.parse(stored);
        return this.finish(
          PROMPTS.resume,
          { pack, options: o, ...(section ? { section } : {}) },
          {
            ...base,
            type: 'resume',
            title: truncate(`Resume · ${o.role} · ${ctx.period.label}`),
          },
        );
      }
      case 'appraisal': {
        const o = AppraisalOptions.parse(stored);
        return this.finish(
          PROMPTS.appraisal,
          { pack, options: o, ...(section ? { section } : {}) },
          {
            ...base,
            type: 'appraisal',
            title: truncate(`Appraisal · ${ctx.period.label}`),
          },
        );
      }
      case 'promotion': {
        const o = PromotionOptions.parse(stored);
        return this.finish(
          PROMPTS.promotion,
          { pack, options: o, ...(section ? { section } : {}) },
          {
            ...base,
            type: 'promotion',
            title: truncate(`Promotion packet · ${o.currentRole} → ${o.targetRole}`),
          },
        );
      }
    }
  }

  async prepareNarrative(
    userId: string,
    spec: string,
    known?: { inputs: ImpactInputs },
  ): Promise<PreparedGeneration & { inputs: ImpactInputs }> {
    const ctx = await this.evidence.context(userId, spec);
    const inputs = known?.inputs ?? (await this.evidence.scoreInputs(userId, ctx.period));
    const pack = await this.evidence.forPeriod(userId, ctx, NARRATIVE_LIMITS, inputs);
    const overall = inputs.overall === null ? null : roundScore(inputs.overall);
    pack.score = {
      overall,
      band: overall === null ? null : impactBand(overall),
      dimensions: Object.entries(inputs.dimensions).map(([key, d]) => ({
        label: key,
        score: d.score === null ? null : roundScore(d.score),
      })),
    };
    const options = {
      period: ctx.period.spec,
      scoreVersion: inputs.scoreVersion,
      inputsHash: inputsHashOf(inputs),
    };
    return {
      ...this.finish(
        PROMPTS.impact_narrative,
        { pack },
        {
          type: 'impact_narrative',
          pack,
          period: ctx.period,
          timezone: ctx.timezone,
          options,
          title: truncate(`Impact highlights · ${ctx.period.label}`),
        },
      ),
      inputs,
    };
  }

  async prepareAchievement(
    userId: string,
    source: { kind: 'pull_request' | 'commit'; id: string },
  ): Promise<PreparedGeneration> {
    const ctx = await this.evidence.context(userId, undefined);
    const { pack, title } = await this.evidence.forItem(userId, ctx, source);
    return this.finish(
      PROMPTS.achievement_statement,
      { pack },
      {
        type: 'achievement_statement',
        pack,
        period: null,
        timezone: ctx.timezone,
        options: { source },
        title: truncate(`Achievement · ${title}`),
      },
    );
  }

  async prepareDigest(userId: string, weekStart: string): Promise<PreparedGeneration> {
    const spec = `custom:${weekStart}..${addDays(weekStart, 6)}`;
    const ctx = await this.evidence.context(userId, spec);
    const pack = await this.evidence.forPeriod(userId, ctx, DIGEST_LIMITS);
    return this.finish(
      PROMPTS.digest_summary,
      { pack },
      {
        type: 'digest_summary',
        pack,
        period: ctx.period,
        timezone: ctx.timezone,
        options: { weekStart },
        title: truncate(`Weekly digest · ${ctx.period.label}`),
      },
    );
  }
}
