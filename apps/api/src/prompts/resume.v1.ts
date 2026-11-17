import { AiFeature } from '@prisma/client';
import { z } from 'zod';

import { dataBlock, fillTemplate } from '../ai/template';
import { promptEvidence } from '../evidence/evidence-pack';
import { CORE_RULES, ModelClaim } from './common';
import { sectionHint, type DocumentPromptInput } from './inputs';
import { withIds, type PromptDefinition } from './types';

import type { ResumeContent, ResumeOptions } from '@devimpact/shared';

const Output = z.object({
  summary: ModelClaim.describe('A one or two sentence professional summary for the period.'),
  bullets: z
    .array(
      ModelClaim.extend({
        theme: z
          .string()
          .min(1)
          .max(60)
          .describe('Short theme, e.g. "Payments reliability" or "Developer experience".'),
      }),
    )
    .max(10),
});
type Output = z.infer<typeof Output>;

const ROLE_FOCUS: Record<ResumeOptions['role'], string> = {
  backend: 'services, APIs, data stores, performance, reliability and scalability',
  frontend: 'user-facing features, UI quality, accessibility, performance and design systems',
  fullstack: 'end-to-end features across UI, APIs and data, and the trade-offs between them',
  devops: 'CI/CD, infrastructure, deployment, observability, reliability and developer tooling',
  manager:
    'technical leadership: unblocking others through reviews, cross-repository collaboration, direction and quality',
};

const SYSTEM = `${CORE_RULES}

Task: resume bullets.
- Write achievement-oriented resume content for the requested role and period, grouping related work into themes (one theme per bullet). Each bullet follows an implicit situation–action–result shape in a single sentence of at most about 35 words, starts with a strong past-tense verb and names the concrete system or area.
- Format "bullets": the requested number of bullets. Format "narrative": instead write 2–4 short paragraphs (each one "bullet" item, 2–4 sentences) that tell the story of the period.
- Prioritise the most significant evidence (it is listed roughly in order of significance) and spread bullets across themes rather than repeating one project.
- Reviews show collaboration and technical leadership; mention them when relevant to the role.
- If a job description is supplied, emphasise matching work, but never claim experience that is not in the evidence.`;

export const RESUME_PROMPT: PromptDefinition<
  DocumentPromptInput<ResumeOptions>,
  Output,
  ResumeContent
> = {
  id: 'resume',
  version: 1,
  model: 'default',
  feature: AiFeature.RESUME,
  maxTokens: 32_000,
  system: SYSTEM,
  outputSchema: Output,
  buildUser: ({ pack, options, section }) => {
    const count =
      options.format === 'narrative'
        ? '2–4 paragraphs'
        : options.length === 'short'
          ? '4–5 bullets'
          : '6–8 bullets';
    return [
      fillTemplate(
        'Write resume content for a {{role}} engineer covering {{period}} ({{count}}, format "{{format}}"). Emphasise {{focus}}.{{hint}}',
        {
          role: options.role,
          period: pack.period.label,
          count,
          format: options.format,
          focus: ROLE_FOCUS[options.role],
          hint: sectionHint(section),
        },
      ),
      options.jobDescription
        ? dataBlock('user_text', { jobDescription: options.jobDescription })
        : '',
      dataBlock('evidence', promptEvidence(pack)),
    ]
      .filter(Boolean)
      .join('\n\n');
  },
  toContent: (output, { options }) => ({
    format: options.format,
    summary: { ...output.summary, id: 's1' },
    bullets: withIds(output.bullets, 'b'),
  }),
};
