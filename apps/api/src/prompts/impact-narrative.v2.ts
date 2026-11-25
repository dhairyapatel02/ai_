import { AiFeature } from '@prisma/client';
import { z } from 'zod';

import { dataBlock, fillTemplate } from '../ai/template';
import { promptEvidence, type EvidencePack } from '../evidence/evidence-pack';
import { CORE_RULES_V2, ModelClaim, ModelPlain, ModelTitledClaim } from './common';
import { withIds, type PromptDefinition } from './types';

import type { ImpactNarrativeContent } from '@devimpact/shared';

const Output = z.object({
  summary: ModelClaim.describe('2–3 sentences explaining what drove this period.'),
  highlights: z.array(ModelTitledClaim).max(5),
  focusAreas: z.array(ModelPlain).max(3).describe('Neutral suggestions; no citations.'),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `${CORE_RULES_V2}

Task: narrative highlights for a computed impact score (F-29).
- The score, its band and dimension scores were computed by a deterministic engine and are given in "impactScore". Never compute, change or second-guess them; you may mention them only exactly as given.
- summary: 2–3 sentences on what work most shaped the period across delivery, quality, collaboration and ownership.
- highlights: 3–5 items, each a short title and 1–2 sentences about a specific piece of work.
- focusAreas: up to 3 neutral, constructive suggestions based on dimensions that had less evidence. Avoid judging the person; the score measures work patterns, not worth.`;

export const IMPACT_NARRATIVE_PROMPT: PromptDefinition<
  { pack: EvidencePack },
  Output,
  ImpactNarrativeContent
> = {
  id: 'impact-narrative',
  version: 2,
  model: 'fast',
  feature: AiFeature.IMPACT_NARRATIVE,
  maxTokens: 8_000,
  system: SYSTEM,
  outputSchema: Output,
  buildUser: ({ pack }) =>
    [
      fillTemplate('Write the impact highlights for {{period}}.', { period: pack.period.label }),
      dataBlock('evidence', promptEvidence(pack)),
    ].join('\n\n'),
  toContent: (output) => ({
    summary: { ...output.summary, id: 's1' },
    highlights: withIds(output.highlights, 'h'),
    focusAreas: withIds(output.focusAreas, 'f'),
  }),
};
