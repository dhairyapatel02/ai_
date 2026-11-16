// AUDIT HELPER (P05) — stands in for the web app's Better Auth JWKS so probe-api.sh can run
// against the v2 API without a browser session.
//
//   node docs/v2/audit/scripts/v2-auth-helper.mjs <port> <aliceUserId> > tokens.json
//
// Serves GET /api/auth/jwks on <port> and prints {"TOKEN_A": ..., "TOKEN_FORGED": ...}
// (EdDSA, iss=http://localhost:3000, aud=devimpact-api, 1 h expiry). Start the API with
//   AUTH_JWKS_URL=http://localhost:<port>/api/auth/jwks AUTH_JWT_ISSUER=http://localhost:3000
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';

const [port = '4011', alice = 'alice'] = process.argv.slice(2);
const trusted = generateKeyPairSync('ed25519');
const attacker = generateKeyPairSync('ed25519');
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(sub, key) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'EdDSA', kid: 'probe', typ: 'JWT' })}.${b64({
    sub,
    iss: 'http://localhost:3000',
    aud: 'devimpact-api',
    iat: now,
    exp: now + 3600,
  })}`;
  return `${input}.${sign(null, Buffer.from(input), key).toString('base64url')}`;
}

const jwk = { ...trusted.publicKey.export({ format: 'jwk' }), kid: 'probe', alg: 'EdDSA', use: 'sig' };
createServer((req, res) => {
  if (req.url === '/api/auth/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  } else res.writeHead(404).end();
}).listen(Number(port), () => {
  console.log(
    JSON.stringify({
      TOKEN_A: token(alice, trusted.privateKey),
      TOKEN_FORGED: token(alice, attacker.privateKey),
    }),
  );
});
