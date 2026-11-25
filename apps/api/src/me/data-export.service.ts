import { once } from 'node:events';

import { todayIn } from '@devimpact/shared';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { Response } from 'express';

export const EXPORT_SCHEMA_VERSION = 1;
const BATCH = 500;

/**
 * Export sections → the Prisma model they come from. `user-data-export.int-spec.ts` checks this
 * list against the schema: every model holding user data appears here or in `EXPORT_EXCLUDED`.
 */
export const EXPORT_SECTIONS = {
  user: 'User',
  settings: 'UserSettings',
  accounts: 'Account',
  sessions: 'Session',
  integrations: 'Integration',
  githubInstallations: 'GitHubInstallation',
  repositories: 'Repository',
  pullRequests: 'PullRequest',
  reviews: 'PullRequestReview',
  commits: 'Commit',
  issues: 'Issue',
  syncRuns: 'SyncRun',
  metricSnapshots: 'MetricSnapshot',
  impactScores: 'ImpactScore',
  legacyImpactScores: 'ImpactScoreLegacy',
  documents: 'GeneratedDocument',
  documentVersions: 'DocumentVersion',
  aiUsage: 'AiUsage',
  achievements: 'Achievement',
  achievementEvidence: 'AchievementEvidence',
  goals: 'Goal',
  goalAchievements: 'GoalAchievement',
  digests: 'DigestDelivery',
} as const;

/** Models deliberately not exported (no user data). */
export const EXPORT_EXCLUDED = {
  Verification: 'short-lived Better Auth verification values, not linked to a user id',
  Jwks: 'server signing keys',
  WebhookDelivery: 'GitHub delivery log without a user id',
} as const;

/** Secret columns that never leave the database (asserted by the export test). */
export const EXPORT_OMITTED_COLUMNS = {
  Account: ['accessToken', 'refreshToken', 'idToken', 'password'],
  Session: ['token'],
  Integration: ['accessTokenEnc', 'refreshTokenEnc', 'syncCursor'],
} as const;

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

type Page<T> = (cursor: string | undefined) => Promise<T[]>;

/**
 * `GET /me/export` (F-04, API_CONTRACT_V2 §5): every user-owned record as one JSON document,
 * streamed in batches (bounded memory), without tokens or secrets. Synchronous by contract.
 */
@Injectable()
export class DataExportService {
  constructor(private readonly prisma: PrismaService) {}

  async filename(userId: string, now = new Date()): Promise<string> {
    const s = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return `devimpact-export-${todayIn(s?.timezone ?? 'UTC', now)}.json`;
  }

  async stream(userId: string, res: Response, now = new Date()): Promise<void> {
    const write = async (chunk: string) => {
      if (!res.write(chunk)) await once(res, 'drain');
    };
    const json = (v: unknown) => JSON.stringify(v, jsonReplacer);
    const array = async <T extends { id: string }>(key: string, page: Page<T>) => {
      await write(`,${json(key)}:[`);
      let cursor: string | undefined;
      let first = true;
      for (;;) {
        const rows = await page(cursor);
        for (const row of rows) {
          await write((first ? '' : ',') + json(row));
          first = false;
        }
        if (rows.length < BATCH) break;
        cursor = rows[rows.length - 1]?.id;
      }
      await write(']');
    };
    const paged = (cursor: string | undefined) => ({
      take: BATCH,
      orderBy: { id: 'asc' as const },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const [user, settings] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.userSettings.findUnique({ where: { userId } }),
    ]);
    await write(
      `{"exportedAt":${json(now.toISOString())},"schemaVersion":${EXPORT_SCHEMA_VERSION},"user":${json(user)},"settings":${json(settings)}`,
    );
    const p = this.prisma;
    await array('accounts', (c) =>
      p.account.findMany({
        where: { userId },
        omit: { accessToken: true, refreshToken: true, idToken: true, password: true },
        ...paged(c),
      }),
    );
    await array('sessions', (c) =>
      p.session.findMany({ where: { userId }, omit: { token: true }, ...paged(c) }),
    );
    await array('integrations', (c) =>
      p.integration.findMany({
        where: { userId },
        omit: { accessTokenEnc: true, refreshTokenEnc: true, syncCursor: true },
        ...paged(c),
      }),
    );
    await array('githubInstallations', (c) =>
      p.gitHubInstallation.findMany({ where: { integration: { userId } }, ...paged(c) }),
    );
    await array('repositories', (c) => p.repository.findMany({ where: { userId }, ...paged(c) }));
    await array('pullRequests', (c) => p.pullRequest.findMany({ where: { userId }, ...paged(c) }));
    await array('reviews', (c) => p.pullRequestReview.findMany({ where: { userId }, ...paged(c) }));
    await array('commits', (c) => p.commit.findMany({ where: { userId }, ...paged(c) }));
    await array('issues', (c) => p.issue.findMany({ where: { userId }, ...paged(c) }));
    await array('syncRuns', (c) => p.syncRun.findMany({ where: { userId }, ...paged(c) }));
    await array('metricSnapshots', (c) =>
      p.metricSnapshot.findMany({ where: { userId }, ...paged(c) }),
    );
    await array('impactScores', (c) => p.impactScore.findMany({ where: { userId }, ...paged(c) }));
    await array('legacyImpactScores', (c) =>
      p.impactScoreLegacy.findMany({ where: { userId }, ...paged(c) }),
    );
    await array('documents', (c) =>
      p.generatedDocument.findMany({ where: { userId }, ...paged(c) }),
    );
    await array('documentVersions', (c) =>
      p.documentVersion.findMany({ where: { document: { userId } }, ...paged(c) }),
    );
    await array('aiUsage', (c) => p.aiUsage.findMany({ where: { userId }, ...paged(c) }));
    await array('achievements', (c) => p.achievement.findMany({ where: { userId }, ...paged(c) }));
    await array('achievementEvidence', (c) =>
      p.achievementEvidence.findMany({ where: { achievement: { userId } }, ...paged(c) }),
    );
    await array('goals', (c) => p.goal.findMany({ where: { userId }, ...paged(c) }));
    // Composite key: one batch per goal page is enough (≤ 100 links per goal by contract).
    await write(
      `,"goalAchievements":${json(
        await p.goalAchievement.findMany({
          where: { goal: { userId } },
          orderBy: [{ goalId: 'asc' }, { achievementId: 'asc' }],
        }),
      )}`,
    );
    await array('digests', (c) => p.digestDelivery.findMany({ where: { userId }, ...paged(c) }));
    await write('}');
  }
}
