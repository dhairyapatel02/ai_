/**
 * E2E helper: (re)creates the disposable `delete-me@devimpact.dev` user (the account-deletion
 * journey deletes it). `npx tsx prisma/scripts/create-throwaway-user.ts`. Never touches the demo user.
 */
import { loadEnvFiles } from '../../src/config/load-env';
import { createPrismaClient } from '../../src/prisma/create-client';
import { seedThrowawayUser } from '../seed-career-os';

loadEnvFiles();

async function main() {
  const prisma = createPrismaClient();
  try {
    const user = await seedThrowawayUser(prisma, new Date());
    console.log(`Created ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
