import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { devimpactPrisma?: PrismaClient };

/**
 * Server-only Prisma client for Better Auth (shared database with the API, ADR-0003). Reused
 * across hot reloads in development.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.devimpactPrisma ??= new PrismaClient();
  return globalForPrisma.devimpactPrisma;
}
