import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 7 talks to Postgres through a driver adapter (`pg`) instead of the Rust query engine
 * (DEBT-10, D-022). Used by scripts and the seed; `PrismaService` passes the same adapter.
 */
export function prismaAdapter(connectionString = process.env.DATABASE_URL): PrismaPg {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new PrismaPg({ connectionString });
}

export function createPrismaClient(connectionString?: string): PrismaClient {
  return new PrismaClient({ adapter: prismaAdapter(connectionString) });
}
