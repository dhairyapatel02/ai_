import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/lib/auth';

// Better Auth endpoints (sign-in, callbacks, session, sign-out, /token, /jwks) — ADR-0003.
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
