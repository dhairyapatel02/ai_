import { AiFeature } from '@prisma/client';
import { z } from 'zod';

import { dataBlock, fillTemplate } from '../ai/template';
import { promptEvidence } from '../evidence/evidence-pack';
import { CORE_RULES, ModelClaim } from './common';
import { sectionHint, type DocumentPromptInput } from './inputs';
import { withIds, type PromptDefinition } from './types';

import type { PromotionContent, PromotionOptions } from '@devimpact/shared';

const Output = z.object({
  whyReady: ModelClaim.describe('A 3–5 sentence case for the promotion.'),
  leadershipEvidence: z.array(ModelClaim).max(6),
  technicalImpact: z.array(ModelClaim).max(6),
  businessValue: z.array(ModelClaim).max(6),
  mentorship: z.array(ModelClaim).max(6),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `${CORE_RULES}

Task: promotion packet (case for moving from the current role to the target role).
- whyReady: 3–5 sentences making the case, tied to the target role's expectations.
- leadershipEvidence: ownership, direction, driving work across repositories or people.
- technicalImpact: the most significant technical contributions and their effect.
- businessValue: user- or business-facing outcomes visible in the evidence (features shipped, reliability, incidents resolved). Do not invent business metrics.
- mentorship: reviews and other help given to teammates (review depth, changes requested, cross-repository reviews).
- 2–6 items per list. Leave a list short rather than stretching thin evidence; an empty list is acceptable.
- If a career ladder or level expectations are supplied, map evidence to them using their wording, but never claim an expectation is met without evidence.
- A supporting-data table computed by the engine is added automatically; do not reproduce it.`;

export const PROMOTION_PROMPT: PromptDefinition<
  DocumentPromptInput<PromotionOptions>,
  Output,
  PromotionContent
> = {
  id: 'promotion',
  version: 1,
  model: 'default',
  feature: AiFeature.PROMOTION,
  maxTokens: 32_000,
  system: SYSTEM,
  outputSchema: Output,
  buildUser: ({ pack, options, section }) =>
    [
      fillTemplate('Write the promotion packet covering {{period}}.{{hint}}', {
        period: pack.period.label,
        hint: sectionHint(section),
      }),
      dataBlock('options', { currentRole: options.currentRole, targetRole: options.targetRole }),
      options.ladderText ? dataBlock('ladder', { ladder: options.ladderText }) : '',
      dataBlock('evidence', promptEvidence(pack)),
    ]
      .filter(Boolean)
      .join('\n\n'),
  toContent: (output, { pack }) => ({
    sections: {
      whyReady: { ...output.whyReady, id: 'wr1' },
      leadershipEvidence: withIds(output.leadershipEvidence, 'le'),
      technicalImpact: withIds(output.technicalImpact, 'ti'),
      businessValue: withIds(output.businessValue, 'bv'),
      mentorship: withIds(output.mentorship, 'me'),
      supportingData: pack.metricValues,
    },
  }),
};
