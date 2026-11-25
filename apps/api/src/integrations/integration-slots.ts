import { IntegrationStatus, type Plan, type Prisma, type Provider } from '@prisma/client';

import { AppException } from '../common/app-exception';
import { limitsFor } from '../entitlements/entitlements';

/** Statuses that occupy one of the user's integration slots (PRD §6). */
export const SLOT_STATUSES: IntegrationStatus[] = [
  IntegrationStatus.ACTIVE,
  IntegrationStatus.SUSPENDED,
  IntegrationStatus.ERROR,
];

type Db = Pick<Prisma.TransactionClient, 'integration'>;

/**
 * Entitlement check before a *new* connection (D-030): at most `integrations` connected sources
 * across all providers and `integrationsPerProvider` per provider. Reconnecting an existing
 * integration never needs a free slot. Throws `403 ENTITLEMENT_REQUIRED`.
 */
export async function assertIntegrationSlot(
  db: Db,
  userId: string,
  plan: Plan,
  provider: Provider,
): Promise<void> {
  const limits = limitsFor(plan);
  const rows = await db.integration.findMany({
    where: { userId, status: { in: SLOT_STATUSES } },
    select: { provider: true },
  });
  const sameProvider = rows.filter((r) => r.provider === provider).length;
  if (sameProvider >= limits.integrationsPerProvider) {
    throw new AppException(
      'ENTITLEMENT_REQUIRED',
      limits.integrationsPerProvider === 1
        ? 'You can connect one account per provider'
        : `Your plan allows ${limits.integrationsPerProvider} connections per provider`,
      {
        entitlement: 'integrations_per_provider',
        limit: limits.integrationsPerProvider,
        provider: provider.toLowerCase(),
        plan: plan.toLowerCase(),
      },
    );
  }
  if (rows.length >= limits.integrations) {
    throw new AppException(
      'ENTITLEMENT_REQUIRED',
      `Your plan allows ${limits.integrations} connected sources`,
      {
        entitlement: 'integrations',
        limit: limits.integrations,
        used: rows.length,
        plan: plan.toLowerCase(),
      },
    );
  }
}
