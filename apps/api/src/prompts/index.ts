import { ACHIEVEMENT_STATEMENT_PROMPT } from './achievement-statement.v1';
import { APPRAISAL_PROMPT } from './appraisal.v1';
import { DIGEST_SUMMARY_PROMPT } from './digest-summary.v1';
import { IMPACT_NARRATIVE_PROMPT } from './impact-narrative.v1';
import { PROMOTION_PROMPT } from './promotion.v1';
import { RESUME_PROMPT } from './resume.v1';

/**
 * Current prompt version per generator. To ship a new version: copy `<name>.vN.ts` to
 * `<name>.v(N+1).ts`, bump `version`, edit, and point the entry below at it (README → AI
 * configuration). Old versions stay in git history; existing documents keep their stored
 * `promptVersion`, and new requests miss the cache because the version is part of `inputHash`.
 */
export const PROMPTS = {
  resume: RESUME_PROMPT,
  appraisal: APPRAISAL_PROMPT,
  promotion: PROMOTION_PROMPT,
  impact_narrative: IMPACT_NARRATIVE_PROMPT,
  achievement_statement: ACHIEVEMENT_STATEMENT_PROMPT,
  digest_summary: DIGEST_SUMMARY_PROMPT,
} as const;

export type PromptKey = keyof typeof PROMPTS;
export { REPAIR_PROMPT } from './repair.v1';
