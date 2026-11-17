import type { EvidencePack } from '../evidence/evidence-pack';

/** Input of the document prompts (studios). */
export interface DocumentPromptInput<Options> {
  pack: EvidencePack;
  options: Options;
  /** Regenerate a single section (F-47 S): only this key is kept from the new output. */
  section?: string;
}

export function sectionHint(section: string | undefined): string {
  return section
    ? `\nOnly the "${section}" part of your answer will be used (the rest of the document is kept); give it your full attention, but still return the complete JSON object.`
    : '';
}
