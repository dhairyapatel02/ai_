import { AiFeature } from '@prisma/client';
import { z } from 'zod';

import { dataBlock } from '../ai/template';
import { promptEvidence, type EvidencePack } from '../evidence/evidence-pack';
import { CORE_RULES } from './common';

import type { PromptDefinition } from './types';
import type { AchievementStatementContent } from '@devimpact/shared';

const Output = z.object({
  title: z.string().min(1).max(120).describe('Short achievement title, 3–10 words.'),
  statement: z
    .string()
    .min(1)
    .max(600)
    .describe('One or two sentences: what was done and why it mattered.'),
  category: z.enum([
    'delivery',
    'quality',
    'mentoring',
    'incident',
    'leadership',
    'learning',
    'collaboration',
    'other',
  ]),
  citations: z.array(z.string()).max(3),
});
type Output = z.infer<typeof Output>;

const SYSTEM = `${CORE_RULES}

Task: turn one pull request or commit into an achievement statement for the engineer's journal (replaces "enhance commit message").
- title: 3–10 words, no trailing period.
- statement: one or two sentences in past tense describing what was done and why it mattered, based only on the title, description and size facts.
- category: the best fit among delivery, quality, mentoring, incident, leadership, learning, collaboration, other.
- citations: the single ref of the item.`;

export const ACHIEVEMENT_STATEMENT_PROMPT: PromptDefinition<
  { pack: EvidencePack },
  Output,
  AchievementStatementContent
> = {
  id: 'achievement-statement',
  version: 1,
  model: 'fast',
  feature: AiFeature.ACHIEVEMENT_STATEMENT,
  maxTokens: 4_000,
  system: SYSTEM,
  outputSchema: Output,
  buildUser: ({ pack }) =>
    ['Write the achievement statement.', dataBlock('evidence', promptEvidence(pack))].join('\n\n'),
  toContent: (output) => output,
};
