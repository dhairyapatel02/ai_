import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

describe('POST /api/dev-login gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const call = () =>
    POST(new Request('http://localhost:3000/api/dev-login', { method: 'POST', body: '{}' }));

  it('returns 404 in production even if ENABLE_DEV_LOGIN=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_LOGIN', 'true');
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns 404 when ENABLE_DEV_LOGIN is not "true"', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_LOGIN', 'false');
    expect((await call()).status).toBe(404);
  });

  it('refuses cross-origin requests when enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_DEV_LOGIN', 'true');
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@localhost:5432/db');
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(40));
    vi.stubEnv('WEB_URL', 'http://localhost:3000');
    const res = await POST(
      new Request('http://localhost:3000/api/dev-login', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(403);
  });
});
