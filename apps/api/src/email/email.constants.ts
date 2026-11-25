/** `email` queue (ARCHITECTURE_V2 §2). Keys live under `QUEUE_PREFIX` like every queue. */
export const EMAIL_QUEUE = 'email';

export const EMAIL_JOBS = {
  digest: 'email.digest',
  fanout: 'email.digest-fanout',
  /** Transactional notification (document ready, sync problem — F-65). */
  send: 'email.send',
} as const;

export const DIGEST_FANOUT_SCHEDULER_ID = 'email-digest-fanout';
/** Every hour on the hour (UTC); each user's local day/hour is checked inside the job. */
export const DIGEST_FANOUT_PATTERN = '0 * * * *';

export interface DigestJobData {
  userId: string;
  /** Local Monday of the digest week (YYYY-MM-DD). */
  weekStart: string;
}

/**
 * One digest per user and week. ARCHITECTURE_V2 names it `digest:<userId>:<weekStart>`; BullMQ
 * custom ids may not contain ':', so it is spelled with '-' (as `sync-<id>`).
 */
export const digestJobId = (userId: string, weekStart: string) => `digest-${userId}-${weekStart}`;

export type NotificationJobData =
  | { kind: 'document_ready'; userId: string; documentId: string }
  | {
      kind: 'sync_problem';
      userId: string;
      integrationId: string;
      problem: 'needs_reauth' | 'sync_failed';
    };

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
