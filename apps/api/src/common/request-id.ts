import { randomUUID } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accept client ids that look like a UUID or a 26-char ULID; anything else is replaced. */
const VALID_REQUEST_ID =
  /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9A-HJKMNP-TV-Z]{26})$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * pino-http `genReqId`: reuse a valid incoming `x-request-id` (generated at the web edge) or mint
 * one, and echo it on the response so clients and logs correlate (API_CONTRACT_V2 §1).
 */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const existing = (req as RequestWithId).id;
  if (typeof existing === 'string') return existing;
  const header = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id = candidate && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** Request id assigned by pino-http (falls back to generating one if logging is bypassed). */
export function requestIdOf(req: IncomingMessage, res?: ServerResponse): string {
  const existing = (req as RequestWithId).id;
  if (typeof existing === 'string') return existing;
  if (res) {
    const id = genRequestId(req, res);
    (req as RequestWithId).id = id;
    return id;
  }
  return 'unknown';
}
