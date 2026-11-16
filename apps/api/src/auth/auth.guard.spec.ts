import { Reflector } from '@nestjs/core';

import { bearer, signTestToken, startJwksServer, type JwksServer } from '../../test/utils/auth';
import { AppException } from '../common/app-exception';
import { IS_PUBLIC, type AuthenticatedRequest } from './auth.decorators';
import { AuthGuard } from './auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';

import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

function contextFor(req: Partial<AuthenticatedRequest>, isPublic = false): ExecutionContext {
  const handler = () => undefined;
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC, true, handler);
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard + JwtVerifierService (JWKS, EdDSA)', () => {
  let jwks: JwksServer;
  let guard: AuthGuard;

  beforeAll(async () => {
    jwks = await startJwksServer();
    const values: Record<string, string> = {
      AUTH_JWT_ISSUER: 'http://localhost:3000',
      AUTH_JWT_AUDIENCE: 'devimpact-api',
      AUTH_JWKS_URL: jwks.url,
    };
    const config = { get: (k: string) => values[k] } as unknown as ConfigService;
    guard = new AuthGuard(new Reflector(), new JwtVerifierService(config as never));
  });

  afterAll(async () => {
    await jwks.close();
  });

  const run = async (authorization?: string, isPublic = false) => {
    const req: Partial<AuthenticatedRequest> = { headers: authorization ? { authorization } : {} };
    await guard.canActivate(contextFor(req, isPublic));
    return req;
  };

  const expectUnauthenticated = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  };

  it('accepts a valid token and sets req.user from `sub` only', async () => {
    const req = await run(bearer('cuser123'));
    expect(req.user).toEqual({ id: 'cuser123' });
  });

  it('ignores x-user-id entirely (SEC-01)', async () => {
    const req: Partial<AuthenticatedRequest> = {
      headers: { authorization: bearer('alice'), 'x-user-id': 'bob' },
    };
    await guard.canActivate(contextFor(req));
    expect(req.user).toEqual({ id: 'alice' });
    await expectUnauthenticated(guard.canActivate(contextFor({ headers: { 'x-user-id': 'bob' } })));
  });

  it('lets @Public() routes through without a token', async () => {
    const req = await run(undefined, true);
    expect(req.user).toBeUndefined();
  });

  it.each([
    ['missing header', undefined],
    ['wrong scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['garbage token', 'Bearer not.a.jwt'],
    ['forged signature', bearer('alice', { forged: true })],
    ['expired (beyond 60 s tolerance)', bearer('alice', { expiresIn: -120 })],
    ['wrong audience', bearer('alice', { aud: 'someone-else' })],
    ['wrong issuer', bearer('alice', { iss: 'https://evil.example' })],
    ['alg none', `Bearer ${signTestToken('alice').split('.').slice(0, 2).join('.')}.`],
    ['unknown kid', bearer('alice', { kid: 'other-key' })],
  ])('rejects %s with 401 UNAUTHENTICATED', async (_name, header) => {
    await expectUnauthenticated(run(header));
  });

  it('tolerates small clock skew (expired 30 s ago)', async () => {
    const req = await run(bearer('alice', { expiresIn: -30 }));
    expect(req.user).toEqual({ id: 'alice' });
  });

  it('throws AppException (mapped by the global filter), never a raw error', async () => {
    await expect(run('Bearer x.y.z')).rejects.toBeInstanceOf(AppException);
  });
});
