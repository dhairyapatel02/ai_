/**
 * Performance fixture (P07 task 7): `npx tsx prisma/scripts/seed-heavy.ts` (from apps/api).
 *
 * Creates `heavy@devimpact.dev` with 12 months of heavy activity (≈ 6k commits, ≈ 1k authored PRs,
 * ≈ 1.7k reviews across 25 repositories, America/New_York) plus 20 filler users with ≈ 1k commits
 * each, so per-user index selectivity resembles a shared production database. Deterministic
 * (fixed RNG seed, relative to today); re-running replaces these users only. Daily snapshots are
 * computed with the real rollup service. Used by `measure-metrics-perf.ts` (PERF_NOTES.md).
 */
import { PRState, Plan, Provider, type Prisma, type PrismaClient } from '@prisma/client';

import { loadEnvFiles } from '../../src/config/load-env';
import { MetricsRepository } from '../../src/metrics/metrics.repository';
import { RollupService } from '../../src/metrics/rollup.service';
import { createPrismaClient } from '../../src/prisma/create-client';
import { createRng } from '../seed';

import type { PrismaService } from '../../src/prisma/prisma.service';

loadEnvFiles();

export const HEAVY_EMAIL = 'heavy@devimpact.dev';
const FILLER_USERS = 20;
const DAYS = 365;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

async function createUser(
  prisma: PrismaClient,
  email: string,
  timezone: string,
): Promise<{ userId: string; integrationId: string; repoIds: string[] }> {
  const user = await prisma.user.create({
    data: {
      email,
      emailVerified: true,
      name: email.split('@')[0] ?? email,
      plan: Plan.PRO,
      settings: { create: { timezone } },
    },
  });
  const integration = await prisma.integration.create({
    data: {
      userId: user.id,
      provider: Provider.GITHUB,
      externalAccountId: `seed:${email}`,
      externalLogin: email.split('@')[0],
    },
  });
  const repoIds: string[] = [];
  for (let i = 0; i < 25; i++) {
    const fullName = `heavy-org/service-${String(i).padStart(2, '0')}`;
    const repo = await prisma.repository.create({
      data: {
        userId: user.id,
        integrationId: integration.id,
        externalId: `seed:${email}:${fullName}`,
        fullName,
        ownerLogin: 'heavy-org',
        name: fullName.split('/')[1] ?? fullName,
        htmlUrl: `https://github.com/${fullName}`,
        included: i < 23, // two excluded repositories
      },
    });
    repoIds.push(repo.id);
  }
  return { userId: user.id, integrationId: integration.id, repoIds };
}

async function insertActivity(
  prisma: PrismaClient,
  owner: { userId: string; integrationId: string; repoIds: string[] },
  scale: { commits: number; prs: number; reviews: number },
  seed: number,
  today: Date,
) {
  const rng = createRng(seed);
  const anchor = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const commits: Prisma.CommitCreateManyInput[] = [];
  const prs: Prisma.PullRequestCreateManyInput[] = [];
  const reviews: {
    prKey: string;
    data: Omit<Prisma.PullRequestReviewCreateManyInput, 'pullRequestId'>;
  }[] = [];
  let number = 1;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dayStart = anchor - daysAgo * DAY_MS;
    const weekday = new Date(dayStart).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    if (weekend && !rng.chance(0.2)) continue;
    const at = () => new Date(dayStart + rng.int(12, 23) * HOUR_MS + rng.int(0, 59) * 60_000);
    for (let i = 0, n = rng.int(0, scale.commits * 2); i < n; i++) {
      const authoredAt = at();
      commits.push({
        userId: owner.userId,
        integrationId: owner.integrationId,
        repositoryId: rng.pick(owner.repoIds),
        sha: rng.hex(40),
        messageHeadline: `change ${i}`,
        branch: 'main',
        additions: rng.int(1, 300),
        deletions: rng.int(0, 100),
        parentsCount: rng.chance(0.08) ? 2 : 1,
        authoredAt,
        committedAt: authoredAt,
      });
    }
    for (let i = 0, n = rng.int(0, scale.prs * 2); i < n; i++) {
      const createdAt = at();
      const draft = rng.chance(0.25);
      const ready = draft ? new Date(createdAt.getTime() + rng.int(1, 30) * HOUR_MS) : null;
      const merged = daysAgo > 2 && rng.chance(0.88);
      const closedAt =
        daysAgo > 2 ? new Date((ready ?? createdAt).getTime() + rng.int(2, 120) * HOUR_MS) : null;
      const additions = rng.int(5, 900);
      prs.push({
        userId: owner.userId,
        integrationId: owner.integrationId,
        repositoryId: rng.pick(owner.repoIds),
        number: number++,
        title: `Heavy PR ${number}`,
        state: closedAt ? (merged ? PRState.MERGED : PRState.CLOSED) : PRState.OPEN,
        isAuthoredByUser: true,
        createdAtRemote: createdAt,
        readyForReviewAt: ready,
        mergedAt: merged ? closedAt : null,
        closedAt,
        additions,
        deletions: rng.int(0, additions),
        firstReviewAt: new Date((ready ?? createdAt).getTime() + rng.int(1, 40) * HOUR_MS),
        changesRequestedCount: rng.chance(0.2) ? 1 : 0,
        revertedAt:
          merged && closedAt && rng.chance(0.03) ? new Date(closedAt.getTime() + DAY_MS) : null,
      });
    }
    for (let i = 0, n = rng.int(0, scale.reviews * 2); i < n; i++) {
      const createdAt = at();
      const prNumber = number++;
      const repositoryId = rng.pick(owner.repoIds);
      const prKey = `${repositoryId}#${prNumber}`;
      prs.push({
        userId: owner.userId,
        integrationId: owner.integrationId,
        repositoryId,
        number: prNumber,
        title: `Teammate PR ${prNumber}`,
        state: PRState.MERGED,
        isAuthoredByUser: false,
        authorLogin: 'teammate',
        createdAtRemote: createdAt,
        mergedAt: new Date(createdAt.getTime() + 30 * HOUR_MS),
        closedAt: new Date(createdAt.getTime() + 30 * HOUR_MS),
      });
      const submittedAt = new Date(createdAt.getTime() + rng.int(1, 30) * HOUR_MS);
      reviews.push({
        prKey,
        data: {
          userId: owner.userId,
          integrationId: owner.integrationId,
          externalId: `seed:review:${prKey}:${owner.userId}`,
          state: rng.chance(0.2) ? 'CHANGES_REQUESTED' : 'APPROVED',
          submittedAt,
          reviewRequestedAt: rng.chance(0.8) ? createdAt : null,
          commentsCount: rng.int(0, 6),
          hasBody: rng.chance(0.5),
        },
      });
    }
  }
  for (let i = 0; i < commits.length; i += 2000) {
    await prisma.commit.createMany({ data: commits.slice(i, i + 2000) });
  }
  for (let i = 0; i < prs.length; i += 2000) {
    await prisma.pullRequest.createMany({ data: prs.slice(i, i + 2000) });
  }
  const prIds = new Map(
    (
      await prisma.pullRequest.findMany({
        where: { userId: owner.userId, isAuthoredByUser: false },
        select: { id: true, repositoryId: true, number: true },
      })
    ).map((p) => [`${p.repositoryId}#${p.number}`, p.id]),
  );
  const reviewRows = reviews.map((r) => ({ ...r.data, pullRequestId: prIds.get(r.prKey) ?? '' }));
  for (let i = 0; i < reviewRows.length; i += 2000) {
    await prisma.pullRequestReview.createMany({ data: reviewRows.slice(i, i + 2000) });
  }
  return {
    commits: commits.length,
    authoredPrs: prs.filter((p) => p.isAuthoredByUser).length,
    reviews: reviewRows.length,
  };
}

export async function seedHeavy(prisma: PrismaClient, today = new Date()) {
  const emails = [
    HEAVY_EMAIL,
    ...Array.from({ length: FILLER_USERS }, (_, i) => `filler${i}@devimpact.dev`),
  ];
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  const heavy = await createUser(prisma, HEAVY_EMAIL, 'America/New_York');
  const counts = await insertActivity(
    prisma,
    heavy,
    { commits: 20, prs: 4, reviews: 6 },
    7_000_001,
    today,
  );
  for (let i = 0; i < FILLER_USERS; i++) {
    const filler = await createUser(prisma, emails[i + 1], 'UTC');
    await insertActivity(prisma, filler, { commits: 2, prs: 1, reviews: 1 }, 8_000_000 + i, today);
  }
  const rollups = new RollupService(new MetricsRepository(prisma as PrismaService));
  const snapshot = await rollups.recompute(
    heavy.userId,
    new Date(today.getTime() - (DAYS + 7) * DAY_MS),
    today,
    today,
  );
  await prisma.$executeRawUnsafe('ANALYZE');
  return {
    userId: heavy.userId,
    ...counts,
    snapshots: snapshot.snapshots,
    fillerUsers: FILLER_USERS,
  };
}

if (require.main === module) {
  const prisma = createPrismaClient();
  seedHeavy(prisma)
    .then((summary) => {
      console.log('Seeded heavy perf user:', summary);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
