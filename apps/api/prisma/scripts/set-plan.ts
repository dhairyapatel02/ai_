/**
 * Admin: assign a plan to a user (D-014 — no billing in v2.0; PRD §6).
 *
 *   npm run plan:set --workspace=apps/api -- someone@example.com PRO
 *   npm run plan:set --workspace=apps/api -- someone@example.com FREE
 *
 * Plans: FREE | PRO (TEAM / ENTERPRISE are reserved for v2.1 and behave like PRO). Limits come from
 * `src/entitlements/entitlements.ts` (+ `ENTITLEMENTS_JSON`). Effects are immediate: quotas and the
 * history window are read on every request. Data older than the previous window is imported by the
 * next backfill (reconnect GitHub, or wait for a full re-sync).
 */
import { Plan } from '@prisma/client';

import { loadEnvFiles } from '../../src/config/load-env';
import { limitsFor } from '../../src/entitlements/entitlements';
import { createPrismaClient } from '../../src/prisma/create-client';

loadEnvFiles();

async function main() {
  const [email, rawPlan] = process.argv.slice(2);
  const plan = rawPlan?.toUpperCase() as Plan | undefined;
  if (!email || !plan || !Object.values(Plan).includes(plan)) {
    console.error('Usage: npm run plan:set --workspace=apps/api -- <email> <FREE|PRO>');
    process.exitCode = 2;
    return;
  }
  const prisma = createPrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, plan: true },
    });
    if (!user) {
      console.error(`No user with email ${email}`);
      process.exitCode = 1;
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { plan } });
    const l = limitsFor(plan);
    console.log(
      `${email}: ${user.plan} → ${plan} (history ${String(l.historyMonths)} months, ` +
        `${String(l.aiGenerationsPerMonth)} generations + ${String(l.aiQuickPerMonth)} quick actions / month)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
