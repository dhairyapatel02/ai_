import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * Test identity provider: an Ed25519 key pair standing in for the web app's Better Auth JWKS.
 * Integration tests start `startJwksServer()` and point `AUTH_JWKS_URL` at it, so the API's real
 * remote-JWKS verification path is exercised end to end.
 */
export const TEST_ISSUER = 'http://localhost:3000';
export const TEST_AUDIENCE = 'devimpact-api';
const KID = 'test-key-1';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
/** A second key the API does not trust (forged-token tests). */
const attacker = generateKeyPairSync('ed25519');

function jwk(key: KeyObject) {
  return {
    ...(key.export({ format: 'jwk' }) as Record<string, string>),
    kid: KID,
    alg: 'EdDSA',
    use: 'sig',
  };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export interface TokenOptions {
  iss?: string;
  aud?: string;
  /** Seconds from now (negative = already expired). Default 900. */
  expiresIn?: number;
  alg?: string;
  kid?: string;
  forged?: boolean;
  extra?: Record<string, unknown>;
}

/** Signs a Better-Auth-shaped API token (EdDSA, iss/aud/sub/iat/exp). */
export function signTestToken(sub: string, options: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: options.alg ?? 'EdDSA', kid: options.kid ?? KID, typ: 'JWT' };
  const payload = {
    sub,
    iss: options.iss ?? TEST_ISSUER,
    aud: options.aud ?? TEST_AUDIENCE,
    iat: now,
    exp: now + (options.expiresIn ?? 900),
    ...options.extra,
  };
  const input = `${b64(header)}.${b64(payload)}`;
  const signature = sign(
    null,
    Buffer.from(input),
    options.forged ? attacker.privateKey : privateKey,
  );
  return `${input}.${signature.toString('base64url')}`;
}

export const bearer = (userId: string, options?: TokenOptions) =>
  `Bearer ${signTestToken(userId, options)}`;

export interface JwksServer {
  url: string;
  close: () => Promise<void>;
  requests: () => number;
}

export async function startJwksServer(): Promise<JwksServer> {
  let count = 0;
  const server: Server = createServer((req, res) => {
    count++;
    if (req.url === '/api/auth/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk(publicKey)] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/api/auth/jwks`,
    requests: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
