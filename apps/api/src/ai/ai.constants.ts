/** `ai` queue (ARCHITECTURE_V2 §2) under QUEUE_PREFIX. BullMQ ids may not contain ':'. */
export const AI_QUEUE = 'ai';
export const AI_JOBS = { generate: 'ai.generate', quick: 'ai.quick' } as const;
export const aiJobId = (documentId: string, version: number) => `ai-${documentId}-${version}`;

export interface AiGenerateJobData {
  documentId: string;
  version: number;
  /** Regenerate a single section (F-47). */
  section?: string;
}

export type AiJobResult =
  | { ok: true }
  | { ok: false; error: { kind: string; code: string; message: string; retryable: boolean } };

/** Quick actions are awaited by the API for at most this long (ARCHITECTURE_V2 §8). */
export const QUICK_WAIT_MS = 20_000;
