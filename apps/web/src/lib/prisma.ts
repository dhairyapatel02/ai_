import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { devimpactPrisma?: PrismaClient };

/**
 * Server-only Prisma client for Better Auth (shared database with the API, ADR-0003). Reused
 * across hot reloads in development. Prisma 7 connects through the `pg` driver adapter.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.devimpactPrisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
  });
  return globalForPrisma.devimpactPrisma;
}
