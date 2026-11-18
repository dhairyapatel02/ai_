import { headers } from 'next/headers';

import { getServerEnv } from '@/env';
import { getAuth } from '@/lib/auth';

import { createApiClient } from './client';

/**
 * Server-side API client for Server Components and route handlers (ADR-0003 / ADR-0010): the JWT
 * comes from `auth.api.getToken` with the incoming request's session cookie. Never import this
 * module from client components (it reads request headers and server env).
 */
export async function getServerApi() {
  const requestHeaders = await headers();
  const env = getServerEnv();
  return createApiClient({
    baseUrl: env.API_INTERNAL_URL,
    getToken: async () => {
      try {
        const { token } = await getAuth().api.getToken({ headers: requestHeaders });
        return token;
      } catch {
        return null; // no (valid) session
      }
    },
  });
}
