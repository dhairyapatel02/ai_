import { AiFeature } from '@prisma/client';
import { z } from 'zod';

import { dataBlock, fillTemplate } from '../ai/template';
import { promptEvidence, type EvidencePack } from '../evidence/evidence-pack';
import { CORE_RULES, ModelClaim } from './common';
import { withIds, type PromptDefinition } from './types';

import type { DigestSummaryContent } from '@devimpact/shared';

const Output = z.object({
  summary: ModelClaim.describe('Two sentences summarising the week.'),
  highlights: z.array(ModelClaim).max(3),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `${CORE_RULES}

Task: a short summary for the engineer's weekly email digest (F-64).
- summary: two friendly, factual sentences about the week's work.
- highlights: up to 3 one-sentence highlights of specific work.
- The digest shows the engine's numbers next to your text; only repeat a number exactly as given.`;

export const DIGEST_SUMMARY_PROMPT: PromptDefinition<
  { pack: EvidencePack },
  Output,
  DigestSummaryContent
> = {
  id: 'digest-summary',
  version: 1,
  model: 'fast',
  feature: AiFeature.DIGEST_SUMMARY,
  maxTokens: 4_000,
  system: SYSTEM,
  outputSchema: Output,
  buildUser: ({ pack }) =>
    [
      fillTemplate('Summarise the week {{period}}.', { period: pack.period.label }),
      dataBlock('evidence', promptEvidence(pack)),
    ].join('\n\n'),
  toContent: (output) => ({
    summary: { ...output.summary, id: 's1' },
    highlights: withIds(output.highlights, 'h'),
  }),
};
