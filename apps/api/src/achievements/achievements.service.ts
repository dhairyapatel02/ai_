import {
  PeriodError,
  localRangeToUtc,
  resolvePeriod,
  todayIn,
  type AchievementCategoryWire,
  type AchievementDto,
  type AchievementInputParsed,
  type AchievementListQuery,
  type AchievementSourceWire,
  type EvidenceItem,
  type PageMeta,
  type UpdateAchievementInput,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { AchievementCategory, AchievementSource, EvidenceKind, type Prisma } from '@prisma/client';

import { AppException } from '../common/app-exception';
import { commitRef, commitUrl, prRef, reviewRef, safeUrl } from '../common/evidence-refs';
import { afterCursor, decodeCursor, toPage } from '../common/pagination';
import { MetricsQueueService } from '../metrics/metrics-queue.service';
import { PrismaService } from '../prisma/prisma.service';

const REPO = { select: { fullName: true, htmlUrl: true, integration: { select: { provider: true } } } } as const;

/** Prisma include that resolves every evidence link to a titled, linkable record. */
export const ACHIEVEMENT_INCLUDE = {
  evidence: {
    include: {
      pullRequest: {
        select: {
          id: true,
          number: true,
          title: true,
          url: true,
          mergedAt: true,
          createdAtRemote: true,
          repository: REPO,
        },
      },
      commit: {
        select: { id: true, sha: true, messageHeadline: true, authoredAt: true, repository: REPO },
      },
      review: {
        select: {
          id: true,
          submittedAt: true,
          pullRequest: { select: { number: true, title: true, url: true, repository: REPO } },
        },
      },
    },
    orderBy: { id: 'asc' },
  },
  goals: { select: { goalId: true } },
} as const satisfies Prisma.AchievementInclude;

export type AchievementRow = Prisma.AchievementGetPayload<{ include: typeof ACHIEVEMENT_INCLUDE }>;

export const achievementRef = (id: string) => `ACH-${id}`;
export const localDate = (d: Date) => d.toISOString().slice(0, 10);
const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

const categoryWire = (c: AchievementCategory) => c.toLowerCase() as AchievementCategoryWire;
const sourceWire = (s: AchievementSource) => s.toLowerCase() as AchievementSourceWire;

function linksOf(raw: Prisma.JsonValue): AchievementDto['links'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => {
    if (typeof l !== 'object' || l === null || Array.isArray(l)) return [];
    const url = safeUrl(typeof l.url === 'string' ? l.url : null);
    if (!url) return [];
    return [{ url, ...(typeof l.label === 'string' && l.label ? { label: l.label } : {}) }];
  });
}

export function evidenceItemsOf(row: AchievementRow): EvidenceItem[] {
  return row.evidence.flatMap((e): EvidenceItem[] => {
    if (e.pullRequest) {
      const p = e.pullRequest;
      return [
        {
          ref: prRef(p.repository.fullName, p.number, p.repository.integration.provider),
          kind: 'pull_request',
          id: p.id,
          title: p.title,
          repo: p.repository.fullName,
          url: safeUrl(p.url),
          occurredAt: (p.mergedAt ?? p.createdAtRemote).toISOString(),
        },
      ];
    }
    if (e.review) {
      const r = e.review;
      return [
        {
          ref: reviewRef(
            r.pullRequest.repository.fullName,
            r.pullRequest.number,
            r.pullRequest.repository.integration.provider,
          ),
          kind: 'review',
          id: r.id,
          title: r.pullRequest.title,
          repo: r.pullRequest.repository.fullName,
          url: safeUrl(r.pullRequest.url),
          occurredAt: r.submittedAt.toISOString(),
        },
      ];
    }
    if (e.commit) {
      const c = e.commit;
      return [
        {
          ref: commitRef(c.repository.fullName, c.sha),
          kind: 'commit',
          id: c.id,
          title: c.messageHeadline,
          repo: c.repository.fullName,
          url: commitUrl(c.repository.htmlUrl, c.sha),
          occurredAt: c.authoredAt.toISOString(),
        },
      ];
    }
    return [];
  });
}

export function toAchievementDto(row: AchievementRow): AchievementDto {
  return {
    id: row.id,
    ref: achievementRef(row.id),
    title: row.title,
    description: row.description,
    impact: row.impact,
    category: categoryWire(row.category),
    occurredOn: localDate(row.occurredOn),
    links: linksOf(row.links),
    source: sourceWire(row.source),
    evidence: evidenceItemsOf(row),
    goalIds: row.goals.map((g) => g.goalId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type EvidenceInput = AchievementInputParsed['evidence'];

/**
 * Achievements journal (API_CONTRACT_V2 §15, F-60/F-61). Every read and write is scoped to the
 * user; linked evidence must be the user's own authored PRs, own commits or own reviews (anything
 * else is `404 NOT_FOUND`, never 403). Saving enqueues `metrics.recompute` for the affected days
 * so the `achievements` snapshot counter stays current.
 */
@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsQueue: MetricsQueueService,
  ) {}

  private async timezone(userId: string): Promise<string> {
    const s = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return s?.timezone ?? 'UTC';
  }

  /** `occurredOn` must not be in the future in the user's time zone (S17 "date ≤ today"). */
  private async assertNotFuture(userId: string, occurredOn: string) {
    const today = todayIn(await this.timezone(userId));
    if (occurredOn > today) {
      throw new AppException('VALIDATION_FAILED', 'The request is invalid', {
        issues: [
          {
            path: 'body.occurredOn',
            message: 'The date must not be in the future',
            code: 'too_big',
          },
        ],
      });
    }
  }

  async list(
    userId: string,
    query: AchievementListQuery,
  ): Promise<{ items: AchievementDto[]; meta: PageMeta }> {
    const where: Prisma.AchievementWhereInput = { userId };
    if (query.category) where.category = query.category.toUpperCase() as AchievementCategory;
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
    if (query.period) {
      const tz = await this.timezone(userId);
      try {
        const p = resolvePeriod(query.period, tz, todayIn(tz));
        where.occurredOn = { gte: toDbDate(p.startDate), lte: toDbDate(p.endDate) };
      } catch (error) {
        if (error instanceof PeriodError) {
          throw new AppException('INVALID_PERIOD', error.message, { period: query.period });
        }
        throw error;
      }
    }
    const key = decodeCursor(query.cursor);
    // user-scope: `where` starts with { userId } above.
    const [rows, total] = await Promise.all([
      this.prisma.achievement.findMany({
        where: { ...where, ...afterCursor('occurredOn', key) },
        include: ACHIEVEMENT_INCLUDE,
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      // user-scope: `where` starts with { userId } above.
      this.prisma.achievement.count({ where }),
    ]);
    const page = toPage(rows, query.limit, (r) => r.occurredOn, total);
    return { items: page.items.map(toAchievementDto), meta: page.meta };
  }

  async get(userId: string, id: string): Promise<AchievementDto> {
    const row = await this.prisma.achievement.findFirst({
      where: { id, userId },
      include: ACHIEVEMENT_INCLUDE,
    });
    if (!row) throw AppException.notFound('Achievement');
    return toAchievementDto(row);
  }

  /** Validates ownership of every evidence id; returns rows for `achievement_evidence`. */
  private async evidenceRows(
    userId: string,
    evidence: EvidenceInput,
  ): Promise<Prisma.AchievementEvidenceCreateWithoutAchievementInput[]> {
    const unique = [...new Map(evidence.map((e) => [`${e.kind}:${e.id}`, e])).values()];
    const ids = (kind: string) => unique.filter((e) => e.kind === kind).map((e) => e.id);
    const [prIds, commitIds, reviewIds] = [ids('pull_request'), ids('commit'), ids('review')];
    const [prs, commits, reviews] = await Promise.all([
      prIds.length
        ? this.prisma.pullRequest.findMany({
            where: { userId, id: { in: prIds }, isAuthoredByUser: true, legacyStub: false },
            select: { id: true },
          })
        : [],
      commitIds.length
        ? this.prisma.commit.findMany({
            where: { userId, id: { in: commitIds } },
            select: { id: true },
          })
        : [],
      reviewIds.length
        ? this.prisma.pullRequestReview.findMany({
            where: { userId, id: { in: reviewIds } },
            select: { id: true },
          })
        : [],
    ]);
    if (
      prs.length !== prIds.length ||
      commits.length !== commitIds.length ||
      reviews.length !== reviewIds.length
    ) {
      throw AppException.notFound('Evidence');
    }
    return unique.map((e) =>
      e.kind === 'pull_request'
        ? { kind: EvidenceKind.PULL_REQUEST, pullRequest: { connect: { id: e.id } } }
        : e.kind === 'commit'
          ? { kind: EvidenceKind.COMMIT, commit: { connect: { id: e.id } } }
          : { kind: EvidenceKind.REVIEW, review: { connect: { id: e.id } } },
    );
  }

  private async recompute(userId: string, dates: Date[]) {
    const tz = await this.timezone(userId);
    const sorted = dates.map(localDate).sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) return;
    const { start, endExclusive } = localRangeToUtc(first, last, tz);
    await this.metricsQueue.enqueueRecompute({
      userId,
      from: start.toISOString(),
      to: new Date(endExclusive.getTime() - 1).toISOString(),
      reason: 'achievement',
    });
  }

  async create(userId: string, input: AchievementInputParsed): Promise<AchievementDto> {
    await this.assertNotFuture(userId, input.occurredOn);
    const evidence = await this.evidenceRows(userId, input.evidence);
    const row = await this.prisma.achievement.create({
      data: {
        user: { connect: { id: userId } },
        title: input.title,
        description: input.description || null,
        impact: input.impact || null,
        category: input.category.toUpperCase() as AchievementCategory,
        occurredOn: toDbDate(input.occurredOn),
        links: input.links,
        source: input.source.toUpperCase() as AchievementSource,
        evidence: { create: evidence },
      },
      include: ACHIEVEMENT_INCLUDE,
    });
    await this.recompute(userId, [row.occurredOn]);
    return toAchievementDto(row);
  }

  async update(userId: string, id: string, input: UpdateAchievementInput): Promise<AchievementDto> {
    const existing = await this.prisma.achievement.findFirst({
      where: { id, userId },
      select: { id: true, occurredOn: true },
    });
    if (!existing) throw AppException.notFound('Achievement');
    if (input.occurredOn) await this.assertNotFuture(userId, input.occurredOn);
    const evidence = input.evidence ? await this.evidenceRows(userId, input.evidence) : null;
    const data: Prisma.AchievementUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.impact !== undefined ? { impact: input.impact || null } : {}),
      ...(input.category ? { category: input.category.toUpperCase() as AchievementCategory } : {}),
      ...(input.occurredOn ? { occurredOn: toDbDate(input.occurredOn) } : {}),
      ...(input.links ? { links: input.links } : {}),
      ...(input.source ? { source: input.source.toUpperCase() as AchievementSource } : {}),
      ...(evidence ? { evidence: { deleteMany: {}, create: evidence } } : {}),
    };
    // user-scope: `existing` was loaded by { id, userId } just above.
    const row = await this.prisma.achievement.update({
      where: { id: existing.id },
      data,
      include: ACHIEVEMENT_INCLUDE,
    });
    await this.recompute(userId, [existing.occurredOn, row.occurredOn]);
    return toAchievementDto(row);
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.achievement.findFirst({
      where: { id, userId },
      select: { id: true, occurredOn: true },
    });
    if (!existing) throw AppException.notFound('Achievement');
    await this.prisma.achievement.deleteMany({ where: { id: existing.id, userId } });
    await this.recompute(userId, [existing.occurredOn]);
    return { deleted: true };
  }
}
