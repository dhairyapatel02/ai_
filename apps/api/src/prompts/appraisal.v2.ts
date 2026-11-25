import { AiFeature } from '@prisma/client';
import { z } from 'zod';

import { dataBlock, fillTemplate } from '../ai/template';
import { promptEvidence } from '../evidence/evidence-pack';
import { CORE_RULES_V2, ModelClaim, ModelPlain, ModelTitledClaim } from './common';
import { sectionHint, type DocumentPromptInput } from './inputs';
import { withIds, type PromptDefinition } from './types';

import type { AppraisalContent, AppraisalOptions } from '@devimpact/shared';

const Output = z.object({
  executiveSummary: ModelClaim.describe('3–5 sentence overview of the period.'),
  keyContributions: z.array(ModelTitledClaim).max(8),
  areasOfImpact: z.array(ModelClaim).max(6),
  growth: z.array(ModelClaim).max(5).describe('Growth and learning visible in the evidence.'),
  nextGoals: z.array(ModelPlain).max(5).describe('Forward-looking goals; no citations needed.'),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `${CORE_RULES_V2}

Task: self-appraisal report for a review period.
- executiveSummary: 3–5 sentences on the most important outcomes of the period.
- keyContributions: 3–8 items, each a short title plus 1–3 sentences on what was delivered and its effect.
- areasOfImpact: 2–6 items on recurring areas (systems, quality, collaboration) where the engineer made a difference.
- growth: 1–5 items on skills or responsibilities that grew, inferred only from the evidence (new areas, larger changes, more reviews).
- nextGoals: 2–5 concrete, forward-looking goals that build on the evidence. These are suggestions, not claims, and carry no citations.
- A metrics table computed by the engine is added to the report automatically; do not reproduce it. You may refer to a metric only with its exact "value" string.
- If a self-reflection from the engineer is supplied, use it for tone and priorities, but every claim still needs evidence.`;

export const APPRAISAL_PROMPT: PromptDefinition<
  DocumentPromptInput<AppraisalOptions>,
  Output,
  AppraisalContent
> = {
  id: 'appraisal',
  version: 2,
  model: 'default',
  feature: AiFeature.APPRAISAL,
  maxTokens: 32_000,
  system: SYSTEM,
  outputSchema: Output,
  buildUser: ({ pack, options, section }) =>
    [
      fillTemplate('Write the appraisal report for {{period}}.{{hint}}', {
        period: pack.period.label,
        hint: sectionHint(section),
      }),
      options.selfReflection
        ? dataBlock('user_text', { selfReflection: options.selfReflection })
        : '',
      dataBlock('evidence', promptEvidence(pack)),
    ]
      .filter(Boolean)
      .join('\n\n'),
  toContent: (output, { pack }) => ({
    sections: {
      executiveSummary: { ...output.executiveSummary, id: 'es1' },
      keyContributions: withIds(output.keyContributions, 'kc'),
      metrics: pack.metricValues,
      areasOfImpact: withIds(output.areasOfImpact, 'ai'),
      growth: withIds(output.growth, 'gr'),
      nextGoals: withIds(output.nextGoals, 'ng'),
    },
  }),
};
