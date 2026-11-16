import { z } from 'zod';

/** `POST /webhooks/github` response (API_CONTRACT_V2 §18). */
export const WebhookAccepted = z.object({ accepted: z.literal(true), duplicate: z.boolean() });
export type WebhookAccepted = z.infer<typeof WebhookAccepted>;
