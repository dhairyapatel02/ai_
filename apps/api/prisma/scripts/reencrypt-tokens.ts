/**
 * Token key rotation (ADR-0005): re-encrypts every stored integration token with the active key.
 * Idempotent — values already on the active version are skipped.
 *
 *   1. Add the new key to TOKEN_ENCRYPTION_KEYS ("1:<old>,2:<new>") and set TOKEN_ENCRYPTION_ACTIVE_KEY=2.
 *   2. Deploy, then run:  npx tsx apps/api/prisma/scripts/reencrypt-tokens.ts
 *   3. Once it reports 0 remaining, remove the old key from TOKEN_ENCRYPTION_KEYS.
 *
 * Never prints token values.
 */
import { validateEnv } from '../../src/config/env';
import { loadEnvFiles } from '../../src/config/load-env';
import { TokenCipher, type TokenField } from '../../src/crypto/token-cipher';
import { createPrismaClient } from '../../src/prisma/create-client';

async function main() {
  loadEnvFiles();
  const env = validateEnv(process.env);
  const cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_ACTIVE_KEY);
  const prisma = createPrismaClient();
  let updated = 0;
  let failed = 0;
  try {
    // user-scope: maintenance script over all rows, by design.
    const rows = await prisma.integration.findMany({
      where: { OR: [{ accessTokenEnc: { not: null } }, { refreshTokenEnc: { not: null } }] },
      select: { id: true, accessTokenEnc: true, refreshTokenEnc: true },
    });
    for (const row of rows) {
      const data: { accessTokenEnc?: string; refreshTokenEnc?: string } = {};
      for (const [field, column] of [
        ['accessToken', 'accessTokenEnc'],
        ['refreshToken', 'refreshTokenEnc'],
      ] as [TokenField, 'accessTokenEnc' | 'refreshTokenEnc'][]) {
        const value = row[column];
        if (!value || TokenCipher.versionOf(value) === cipher.active) continue;
        try {
          const aad = TokenCipher.aad(row.id, field);
          data[column] = cipher.encrypt(cipher.decrypt(value, aad), aad);
        } catch {
          failed++;
          console.error(`integration ${row.id}: ${field} could not be decrypted (missing key?)`);
        }
      }
      if (Object.keys(data).length > 0) {
        // user-scope: row id comes from the scan above.
        await prisma.integration.update({ where: { id: row.id }, data });
        updated++;
      }
    }
    console.log(
      `Re-encrypted ${updated} integration(s) with key v${cipher.active}; ${failed} failure(s).`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
