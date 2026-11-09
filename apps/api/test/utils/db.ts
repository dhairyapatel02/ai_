import type { PrismaClient } from '@prisma/client';

/** Empties every application table. Call in `beforeEach` of integration tests. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
