import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SyncTrigger, type SyncRun } from '@prisma/client';

import { TokenCipher } from '../../src/crypto/token-cipher';
import { scheduleSlotFor } from '../../src/integrations/integration.mapper';
import { SyncEngine } from '../../src/sync/sync-engine.service';
import { SyncService } from '../../src/sync/sync.service';
import { TEST_SECRETS } from './test-env';

import type { TestApp } from './app';
import type { FakeDataset, FakeGitHubState, FakeInstallation } from './fake-github';

const FIXTURES = path.resolve(__dirname, '../fixtures/github');

/** "-40d" / "-3h" / "-15m" → ISO timestamp relative to `now`; other values unchanged. */
function relative(value: unknown, now: number): unknown {
  if (typeof value === 'string') {
    const m = /^-(\d+)([dhm])$/.exec(value);
    if (m) {
      const unit = m[2] === 'd' ? 86_400_000 : m[2] === 'h' ? 3_600_000 : 60_000;
      return new Date(now - Number(m[1]) * unit).toISOString();
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => relative(v, now));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, relative(v, now)]));
  }
  return value;
}

export function loadDataset(name = 'basic-dataset', now = Date.now()): FakeDataset {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
  delete raw.$comment;
  return relative(raw, now) as FakeDataset;
}

export function loadWebhook(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, 'webhooks', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

export const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
export const sign = (body: string, secret = WEBHOOK_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export const testCipher = () => {
  const keys = new Map<number, Buffer>();
  for (const entry of TEST_SECRETS.TOKEN_ENCRYPTION_KEYS.split(',')) {
    const [version, key] = entry.split(':');
    keys.set(Number(version), Buffer.from(key ?? '', 'base64'));
  }
  return new TokenCipher(keys, Number(TEST_SECRETS.TOKEN_ENCRYPTION_ACTIVE_KEY));
};

export interface ConnectOptions {
  login?: string;
  nodeId?: string;
  token?: string;
  refresh?: string | null;
  accessTokenExpiresAt?: Date | null;
  installations?: FakeInstallation[];
}

export const DEFAULT_INSTALLATIONS: FakeInstallation[] = [
  {
    id: 101,
    account: { login: 'octo', type: 'User' },
    repository_selection: 'all',
    suspended_at: null,
  },
  {
    id: 102,
    account: { login: 'acme', type: 'Organization' },
    repository_selection: 'selected',
    suspended_at: null,
  },
];

/** An ACTIVE GitHub App integration with encrypted tokens, known to the fake GitHub. */
export async function connectGitHub(
  t: TestApp,
  gh: FakeGitHubState,
  userId: string,
  options: ConnectOptions = {},
) {
  const login = options.login ?? 'octo';
  const nodeId = options.nodeId ?? 'U_octo';
  const token = options.token ?? `gho_${login}_token`;
  const refresh = options.refresh === undefined ? `ghr_${login}_refresh` : options.refresh;
  gh.users.set(token, { id: 1, node_id: nodeId, login, name: login, avatar_url: null });
  gh.installations.set(token, options.installations ?? DEFAULT_INSTALLATIONS);
  const cipher = testCipher();
  const integration = await t.prisma.integration.create({
    data: {
      userId,
      provider: 'GITHUB',
      mechanism: 'GITHUB_APP',
      externalAccountId: nodeId,
      externalLogin: login,
    },
  });
  return t.prisma.integration.update({
    where: { id: integration.id },
    data: {
      accessTokenEnc: cipher.encrypt(token, TokenCipher.aad(integration.id, 'accessToken')),
      refreshTokenEnc: refresh
        ? cipher.encrypt(refresh, TokenCipher.aad(integration.id, 'refreshToken'))
        : null,
      accessTokenExpiresAt:
        options.accessTokenExpiresAt === undefined
          ? new Date(Date.now() + 8 * 3_600_000)
          : options.accessTokenExpiresAt,
      refreshTokenExpiresAt: refresh ? new Date(Date.now() + 180 * 86_400_000) : null,
      scheduleSlotMinute: scheduleSlotFor(integration.id),
      installations: {
        create: (options.installations ?? DEFAULT_INSTALLATIONS).map((i) => ({
          installationId: BigInt(i.id),
          accountLogin: i.account.login,
          accountType: i.account.type,
          repositorySelection: i.repository_selection,
        })),
      },
    },
  });
}

/** Queues a run like `POST /sync` does, then executes it in-process (no worker in tests). */
export async function runSync(
  t: TestApp,
  userId: string,
  integrationId: string,
  trigger: SyncTrigger = SyncTrigger.SCHEDULED,
): Promise<{ run: SyncRun; outcome: Awaited<ReturnType<SyncEngine['run']>> }> {
  const dto = await t.app.get(SyncService).requestSync(userId, { integrationId, trigger });
  const outcome = await t.app.get(SyncEngine).run(dto.id, userId);
  const run = await t.prisma.syncRun.findUniqueOrThrow({ where: { id: dto.id } });
  return { run, outcome };
}

/** Executes an existing run again (resume after a rate-limit pause or retry). */
export async function resumeSync(t: TestApp, run: SyncRun) {
  const outcome = await t.app.get(SyncEngine).run(run.id, run.userId);
  return { outcome, run: await t.prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } }) };
}

/** Row counts of every activity table (idempotency assertions). */
export async function activityCounts(t: TestApp) {
  const [repositories, pullRequests, reviews, commits] = await Promise.all([
    t.prisma.repository.count(),
    t.prisma.pullRequest.count(),
    t.prisma.pullRequestReview.count(),
    t.prisma.commit.count(),
  ]);
  return { repositories, pullRequests, reviews, commits };
}
