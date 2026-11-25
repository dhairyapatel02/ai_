import {
  PeriodError,
  businessHours,
  localDateOf,
  localRangeToUtc,
  resolvePeriod,
  toUtcRange,
  todayIn,
  type ActivityListQuery,
  type ActivityType,
  type CommitDetail,
  type CommitItem,
  type FeedItem,
  type FeedQuery,
  type IssueDetail,
  type IssueItem,
  type IssueListQuery,
  type PageMeta,
  type PullRequestDetail,
  type PullRequestListItem,
  type PullRequestListQuery,
  type ReviewItem,
  type ReviewListQuery,
  type ReviewStateWire,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { IssueStatus, PRState, Prisma, type Provider, type ReviewState } from '@prisma/client';

import { AppException } from '../common/app-exception';
import {
  REPO_PROVIDER,
  commitRef,
  commitUrl,
  issueRef,
  prRef,
  repoRef,
  reviewRef,
  safeUrl,
} from '../common/evidence-refs';
import {
  afterCursor,
  decodeCursor,
  decodeOffsetCursor,
  encodeCursor,
  encodeOffsetCursor,
  toPage,
  type CursorKey,
} from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

type Range = { gte?: Date; lt?: Date } | undefined;
type Filter = Pick<ActivityListQuery, 'period' | 'from' | 'to' | 'repoIds' | 'providers' | 'q'>;

const FEED_TYPES: ActivityType[] = [
  'commit',
  'pr_opened',
  'pr_merged',
  'pr_closed',
  'review',
  'achievement',
  'issue',
];
const REPO_SELECT = {
  select: { id: true, fullName: true, htmlUrl: true, ...REPO_PROVIDER },
} as const;
const ISSUE_PROVIDERS = ['jira', 'linear'] as const;

const prStateWire = (state: PRState) => state.toLowerCase() as 'open' | 'merged' | 'closed';
const reviewStateWire = (state: ReviewState) => state.toLowerCase() as ReviewStateWire;

/** Keyset condition for a feed source whose synthetic ids are `<prefix>:<rowId>`. */
function feedAfter(field: string, prefix: string, key: CursorKey | undefined) {
  if (!key) return {};
  const t = new Date(key.t);
  const own = `${prefix}:`;
  const sameTime = key.id.startsWith(own)
    ? [{ [field]: t, id: { lt: key.id.slice(own.length) } }]
    : own < key.id
      ? [{ [field]: t }]
      : [];
  return { OR: [{ [field]: { lt: t } }, ...sameTime] } as Record<string, unknown>;
}

/**
 * Activity reads (API_CONTRACT_V2 §11, F-23/F-25): unified feed, PRs by role, reviews and commits
 * with their details. Every read is scoped to the user and to included repositories; authored and
 * reviewed PRs never mix (DATA-01); v0.1 stubs and merge commits are never listed. Date-only bounds
 * are inclusive local days in the user's time zone (BUG-05); `period` follows §3.4.
 */
@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  /** The user's IANA time zone (D-019). */
  async timezoneOf(userId: string): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return settings?.timezone ?? 'UTC';
  }

  private async range(userId: string, filter: Filter, timezone?: string): Promise<Range> {
    if (filter.period === undefined && filter.from === undefined && filter.to === undefined) {
      return undefined;
    }
    const tz = timezone ?? (await this.timezoneOf(userId));
    if (filter.period !== undefined) {
      try {
        const p = resolvePeriod(filter.period, tz, todayIn(tz));
        const { start, endExclusive } = localRangeToUtc(p.startDate, p.endDate, tz);
        return { gte: start, lt: endExclusive };
      } catch (error) {
        if (error instanceof PeriodError) {
          throw new AppException('INVALID_PERIOD', error.message, { period: filter.period });
        }
        throw error;
      }
    }
    return toUtcRange(filter, tz);
  }

  private repoWhere(filter: Filter): Prisma.RepositoryWhereInput {
    return {
      included: true,
      ...(filter.repoIds ? { id: { in: filter.repoIds } } : {}),
      ...(filter.providers
        ? {
            integration: {
              provider: { in: filter.providers.map((p) => p.toUpperCase() as Provider) },
            },
          }
        : {}),
    };
  }

  /** Issue providers selected by the filter (all when no provider filter is set). */
  private issueProviders(filter: Filter): Provider[] {
    const wanted = filter.providers ?? [...ISSUE_PROVIDERS];
    return wanted
      .filter((p): p is (typeof ISSUE_PROVIDERS)[number] =>
        (ISSUE_PROVIDERS as readonly string[]).includes(p),
      )
      .map((p) => p.toUpperCase() as Provider);
  }

  private titleWhere(q: string | undefined) {
    return q === undefined ? {} : { contains: q, mode: 'insensitive' as const };
  }

  // ── Feed ───────────────────────────────────────────────────────────────────────────────

  /** Feed time of an achievement: local noon of `occurredOn` in the user's time zone. */
  private achievementAt(date: string, timezone: string): Date {
    return new Date(localRangeToUtc(date, date, timezone).start.getTime() + 12 * 3_600_000);
  }

  /**
   * Achievements for the feed (F-61). They have no repository, so a repository filter excludes
   * them. Every achievement of a day shares one feed time (local noon), so the keyset condition
   * is a date bound plus the synthetic-id tie-break used by the other sources.
   */
  private async achievementFeed(
    userId: string,
    timezone: string,
    range: Range,
    key: CursorKey | undefined,
    q: string | undefined,
    take: number,
  ): Promise<FeedItem[]> {
    const occurredOn: Prisma.DateTimeFilter = {};
    const dbDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
    if (range?.gte) occurredOn.gte = dbDate(localDateOf(range.gte, timezone));
    if (range?.lt) occurredOn.lte = dbDate(localDateOf(new Date(range.lt.getTime() - 1), timezone));
    const keyset: Prisma.AchievementWhereInput[] = [];
    if (key) {
      const t = new Date(key.t);
      const keyDate = localDateOf(t, timezone);
      const noon = this.achievementAt(keyDate, timezone).getTime();
      const own = 'achievement:';
      if (noon < t.getTime()) keyset.push({ occurredOn: { lte: dbDate(keyDate) } });
      else if (noon > t.getTime()) keyset.push({ occurredOn: { lt: dbDate(keyDate) } });
      else {
        const sameDay: Prisma.AchievementWhereInput[] = key.id.startsWith(own)
          ? [{ occurredOn: dbDate(keyDate), id: { lt: key.id.slice(own.length) } }]
          : own < key.id
            ? [{ occurredOn: dbDate(keyDate) }]
            : [];
        keyset.push({ OR: [{ occurredOn: { lt: dbDate(keyDate) } }, ...sameDay] });
      }
    }
    const rows = await this.prisma.achievement.findMany({
      where: {
        userId,
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
        AND: [range ? { occurredOn } : {}, ...keyset],
      },
      select: { id: true, title: true, category: true, impact: true, occurredOn: true },
      orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      take,
    });
    return rows.map((a) => {
      const date = a.occurredOn.toISOString().slice(0, 10);
      return {
        id: `achievement:${a.id}`,
        type: 'achievement' as const,
        occurredAt: this.achievementAt(date, timezone).toISOString(),
        repo: null,
        title: a.title,
        url: null,
        ref: `ACH-${a.id}`,
        meta: {
          recordId: a.id,
          category: a.category.toLowerCase(),
          occurredOn: date,
          impact: a.impact,
        },
      };
    });
  }

  async feed(userId: string, query: FeedQuery): Promise<{ items: FeedItem[]; meta: PageMeta }> {
    const timezone = await this.timezoneOf(userId);
    const range = await this.range(userId, query, timezone);
    const key = decodeCursor(query.cursor);
    const types = new Set(query.types ?? FEED_TYPES);
    const take = query.limit + 1;
    const repository = this.repoWhere(query);
    const title = this.titleWhere(query.q);
    const order = (field: string) => [{ [field]: 'desc' as const }, { id: 'desc' as const }];
    const authored = { isAuthoredByUser: true, legacyStub: false, repository };
    const prSelect = {
      id: true,
      number: true,
      title: true,
      url: true,
      state: true,
      isDraft: true,
      additions: true,
      deletions: true,
      createdAtRemote: true,
      mergedAt: true,
      closedAt: true,
      repository: REPO_SELECT,
    } as const;

    const [commits, opened, merged, closed, reviews, achievements] = await Promise.all([
      types.has('commit')
        ? this.prisma.commit.findMany({
            where: {
              userId,
              parentsCount: { lte: 1 },
              repository,
              ...(query.q ? { messageHeadline: title } : {}),
              AND: [range ? { authoredAt: range } : {}, feedAfter('authoredAt', 'commit', key)],
            },
            include: { repository: REPO_SELECT },
            orderBy: order('authoredAt'),
            take,
          })
        : [],
      types.has('pr_opened')
        ? this.prisma.pullRequest.findMany({
            where: {
              ...authored,
              userId,
              ...(query.q ? { title } : {}),
              AND: [
                range ? { createdAtRemote: range } : {},
                feedAfter('createdAtRemote', 'pr_opened', key),
              ],
            },
            select: prSelect,
            orderBy: order('createdAtRemote'),
            take,
          })
        : [],
      types.has('pr_merged')
        ? this.prisma.pullRequest.findMany({
            where: {
              ...authored,
              userId,
              ...(query.q ? { title } : {}),
              mergedAt: { not: null },
              AND: [range ? { mergedAt: range } : {}, feedAfter('mergedAt', 'pr_merged', key)],
            },
            select: prSelect,
            orderBy: order('mergedAt'),
            take,
          })
        : [],
      types.has('pr_closed')
        ? this.prisma.pullRequest.findMany({
            where: {
              ...authored,
              userId,
              ...(query.q ? { title } : {}),
              mergedAt: null,
              closedAt: { not: null },
              AND: [range ? { closedAt: range } : {}, feedAfter('closedAt', 'pr_closed', key)],
            },
            select: prSelect,
            orderBy: order('closedAt'),
            take,
          })
        : [],
      types.has('review')
        ? this.prisma.pullRequestReview.findMany({
            where: {
              userId,
              pullRequest: {
                isAuthoredByUser: false,
                legacyStub: false,
                repository,
                ...(query.q ? { title } : {}),
              },
              AND: [range ? { submittedAt: range } : {}, feedAfter('submittedAt', 'review', key)],
            },
            include: {
              pullRequest: {
                select: {
                  id: true,
                  number: true,
                  title: true,
                  url: true,
                  authorLogin: true,
                  repository: REPO_SELECT,
                },
              },
            },
            orderBy: order('submittedAt'),
            take,
          })
        : [],
      types.has('achievement') && !query.repoIds?.length && !query.providers?.length
        ? this.achievementFeed(userId, timezone, range, key, query.q, take)
        : [],
    ]);
    // Completed issues (Jira / Linear, P13): no repository, so a repository filter excludes them.
    const issueProviders = this.issueProviders(query);
    const issues =
      types.has('issue') && !query.repoIds?.length && issueProviders.length > 0
        ? await this.prisma.issue.findMany({
            where: {
              userId,
              status: IssueStatus.DONE,
              completedAt: { not: null },
              integration: { provider: { in: issueProviders } },
              ...(query.q ? { title } : {}),
              AND: [range ? { completedAt: range } : {}, feedAfter('completedAt', 'issue', key)],
            },
            include: { integration: { select: { provider: true } } },
            orderBy: order('completedAt'),
            take,
          })
        : [];

    const items: FeedItem[] = [
      ...achievements.map((a) => ({ ...a, provider: null })),
      ...issues.map((i) => ({
        id: `issue:${i.id}`,
        type: 'issue' as const,
        occurredAt: (i.completedAt ?? i.updatedAtRemote).toISOString(),
        repo: null,
        title: i.title,
        url: safeUrl(i.url),
        ref: issueRef(i.integration.provider, i.key),
        provider: i.integration.provider.toLowerCase() as FeedItem['provider'],
        meta: {
          recordId: i.id,
          key: i.key,
          status: i.status.toLowerCase(),
          storyPoints: i.storyPoints,
          project: i.projectName,
        },
      })),
      ...commits.map((c) => ({
        id: `commit:${c.id}`,
        type: 'commit' as const,
        occurredAt: c.authoredAt.toISOString(),
        repo: repoRef(c.repository),
        title: c.messageHeadline,
        url: commitUrl(c.repository.htmlUrl, c.sha, c.repository.integration.provider),
        ref: commitRef(c.repository.fullName, c.sha),
        provider: repoRef(c.repository).provider,
        meta: { recordId: c.id, sha: c.sha, additions: c.additions, deletions: c.deletions },
      })),
      ...(
        [
          ['pr_opened', opened, (p: (typeof opened)[number]) => p.createdAtRemote],
          ['pr_merged', merged, (p: (typeof opened)[number]) => p.mergedAt ?? p.createdAtRemote],
          ['pr_closed', closed, (p: (typeof opened)[number]) => p.closedAt ?? p.createdAtRemote],
        ] as const
      ).flatMap(([type, rows, at]) =>
        rows.map((p) => ({
          id: `${type}:${p.id}`,
          type,
          occurredAt: at(p).toISOString(),
          repo: repoRef(p.repository),
          title: p.title,
          url: safeUrl(p.url),
          ref: prRef(p.repository.fullName, p.number, p.repository.integration.provider),
          provider: repoRef(p.repository).provider,
          meta: {
            recordId: p.id,
            number: p.number,
            state: prStateWire(p.state),
            isDraft: p.isDraft,
            additions: p.additions,
            deletions: p.deletions,
          },
        })),
      ),
      ...reviews.map((r) => ({
        id: `review:${r.id}`,
        type: 'review' as const,
        occurredAt: r.submittedAt.toISOString(),
        repo: repoRef(r.pullRequest.repository),
        title: r.pullRequest.title,
        url: safeUrl(r.pullRequest.url),
        ref: reviewRef(
          r.pullRequest.repository.fullName,
          r.pullRequest.number,
          r.pullRequest.repository.integration.provider,
        ),
        provider: repoRef(r.pullRequest.repository).provider,
        meta: {
          recordId: r.id,
          pullRequestId: r.pullRequest.id,
          number: r.pullRequest.number,
          reviewState: reviewStateWire(r.state),
          comments: r.commentsCount,
          authorLogin: r.pullRequest.authorLogin,
        },
      })),
    ].sort((a, b) =>
      a.occurredAt !== b.occurredAt
        ? a.occurredAt < b.occurredAt
          ? 1
          : -1
        : a.id < b.id
          ? 1
          : a.id > b.id
            ? -1
            : 0,
    );

    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      meta: {
        nextCursor: hasMore && last ? encodeCursor({ t: last.occurredAt, id: last.id }) : null,
        hasMore,
      },
    };
  }

  // ── Pull requests ──────────────────────────────────────────────────────────────────────

  private prItem(
    p: Prisma.PullRequestGetPayload<{
      include: {
        repository: typeof REPO_SELECT;
        reviews: { select: { state: true; submittedAt: true } };
      };
    }>,
    timezone: string,
  ): PullRequestListItem {
    const readyAt = p.readyForReviewAt ?? p.createdAtRemote;
    const authored = p.isAuthoredByUser;
    const latest = p.reviews[0];
    return {
      id: p.id,
      ref: prRef(p.repository.fullName, p.number, p.repository.integration.provider),
      repo: repoRef(p.repository),
      number: p.number,
      title: p.title,
      url: safeUrl(p.url),
      state: prStateWire(p.state),
      isDraft: p.isDraft,
      isAuthoredByUser: authored,
      authorLogin: p.authorLogin,
      createdAt: p.createdAtRemote.toISOString(),
      readyAt: readyAt.toISOString(),
      mergedAt: p.mergedAt?.toISOString() ?? null,
      closedAt: p.closedAt?.toISOString() ?? null,
      additions: p.additions,
      deletions: p.deletions,
      changedFiles: p.changedFiles,
      cycleTimeHours: authored && p.mergedAt ? businessHours(readyAt, p.mergedAt, timezone) : null,
      firstReviewHours:
        authored && p.firstReviewAt ? businessHours(readyAt, p.firstReviewAt, timezone) : null,
      reverted: p.revertedAt !== null,
      ...(authored
        ? {}
        : {
            myReviews: {
              count: p.reviews.length,
              latestState: latest ? reviewStateWire(latest.state) : null,
            },
          }),
    };
  }

  async pullRequests(
    userId: string,
    query: PullRequestListQuery,
  ): Promise<{ items: PullRequestListItem[]; meta: PageMeta }> {
    const timezone = await this.timezoneOf(userId);
    const range = await this.range(userId, query, timezone);
    const field = query.sort === '-mergedAt' ? 'mergedAt' : 'createdAtRemote';
    const where: Prisma.PullRequestWhereInput = {
      userId,
      isAuthoredByUser: query.role === 'authored',
      legacyStub: false,
      repository: this.repoWhere(query),
      ...(query.q ? { title: this.titleWhere(query.q) } : {}),
      ...(query.state ? { state: query.state.toUpperCase() as PRState } : {}),
      ...(query.sort === '-mergedAt' ? { mergedAt: { not: null } } : {}),
      ...(range ? { [field]: range } : {}),
    };
    const include = {
      repository: REPO_SELECT,
      reviews: {
        where: { userId },
        select: { state: true, submittedAt: true },
        orderBy: { submittedAt: 'desc' as const },
      },
    };

    if (query.sort === '-changedLines') {
      // Ordered by a computed value: rank ids in memory, then page by offset (opaque cursor).
      const ranked = await this.prisma.pullRequest.findMany({
        where: { ...where, userId },
        select: { id: true, additions: true, deletions: true, createdAtRemote: true },
      });
      ranked.sort(
        (a, b) =>
          (b.additions ?? -1) + (b.deletions ?? 0) - ((a.additions ?? -1) + (a.deletions ?? 0)) ||
          b.createdAtRemote.getTime() - a.createdAtRemote.getTime() ||
          (a.id < b.id ? 1 : -1),
      );
      const offset = decodeOffsetCursor(query.cursor);
      const ids = ranked.slice(offset, offset + query.limit).map((r) => r.id);
      const rows = await this.prisma.pullRequest.findMany({
        where: { userId, id: { in: ids } },
        include,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const hasMore = offset + query.limit < ranked.length;
      return {
        items: ids.flatMap((id) => {
          const row = byId.get(id);
          return row ? [this.prItem(row, timezone)] : [];
        }),
        meta: { nextCursor: hasMore ? encodeOffsetCursor(offset + query.limit) : null, hasMore },
      };
    }

    const rows = await this.prisma.pullRequest.findMany({
      where: { userId, AND: [where, afterCursor(field, decodeCursor(query.cursor))] },
      include,
      orderBy: [{ [field]: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) =>
      field === 'mergedAt' ? (row.mergedAt ?? row.createdAtRemote) : row.createdAtRemote,
    );
    return { meta: page.meta, items: page.items.map((row) => this.prItem(row, timezone)) };
  }

  async pullRequest(userId: string, id: string): Promise<PullRequestDetail> {
    const timezone = await this.timezoneOf(userId);
    const row = await this.prisma.pullRequest.findFirst({
      where: { id, userId, legacyStub: false, repository: { included: true } },
      include: {
        repository: REPO_SELECT,
        reviews: {
          where: { userId },
          orderBy: { submittedAt: 'desc' },
        },
        evidence: {
          where: { achievement: { userId } },
          select: { achievementId: true },
        },
      },
    });
    if (!row) throw AppException.notFound('Pull request');
    const item = this.prItem(row, timezone);
    return {
      ...item,
      body: row.isAuthoredByUser ? row.body : null,
      labels: row.labels,
      reviewersCount: row.reviewersCount,
      approvalsCount: row.approvalsCount,
      changesRequestedCount: row.changesRequestedCount,
      myReviews: row.reviews.map((r) => this.reviewItem({ ...r, pullRequest: row }, timezone)),
      revertedByUrl: safeUrl(row.revertedByUrl),
      achievementIds: [...new Set(row.evidence.map((e) => e.achievementId))],
    };
  }

  // ── Reviews ────────────────────────────────────────────────────────────────────────────

  private reviewItem(
    r: {
      id: string;
      state: ReviewState;
      submittedAt: Date;
      reviewRequestedAt: Date | null;
      commentsCount: number;
      hasBody: boolean;
      pullRequest: {
        id: string;
        number: number;
        title: string;
        url: string | null;
        authorLogin: string | null;
        repository: { id: string; fullName: string; integration?: { provider: string } | null };
      };
    },
    timezone: string,
  ): ReviewItem {
    const repo = r.pullRequest.repository;
    return {
      id: r.id,
      ref: reviewRef(repo.fullName, r.pullRequest.number, repo.integration?.provider),
      pullRequest: {
        id: r.pullRequest.id,
        repo: repoRef(repo),
        number: r.pullRequest.number,
        title: r.pullRequest.title,
        url: safeUrl(r.pullRequest.url),
        authorLogin: r.pullRequest.authorLogin,
      },
      state: reviewStateWire(r.state),
      submittedAt: r.submittedAt.toISOString(),
      commentsCount: r.commentsCount,
      hasBody: r.hasBody,
      turnaroundHours: r.reviewRequestedAt
        ? businessHours(r.reviewRequestedAt, r.submittedAt, timezone)
        : null,
    };
  }

  async reviews(
    userId: string,
    query: ReviewListQuery,
  ): Promise<{ items: ReviewItem[]; meta: PageMeta }> {
    const timezone = await this.timezoneOf(userId);
    const range = await this.range(userId, query, timezone);
    const rows = await this.prisma.pullRequestReview.findMany({
      where: {
        userId,
        pullRequest: {
          isAuthoredByUser: false,
          legacyStub: false,
          repository: this.repoWhere(query),
          ...(query.q ? { title: this.titleWhere(query.q) } : {}),
        },
        ...(query.state ? { state: query.state.toUpperCase() as ReviewState } : {}),
        ...(range ? { submittedAt: range } : {}),
        ...afterCursor('submittedAt', decodeCursor(query.cursor)),
      },
      include: {
        pullRequest: {
          select: {
            id: true,
            number: true,
            title: true,
            url: true,
            authorLogin: true,
            repository: REPO_SELECT,
          },
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) => row.submittedAt);
    return { meta: page.meta, items: page.items.map((r) => this.reviewItem(r, timezone)) };
  }

  // ── Commits ────────────────────────────────────────────────────────────────────────────

  private commitItem(
    c: Prisma.CommitGetPayload<{ include: { repository: typeof REPO_SELECT } }>,
  ): CommitItem {
    return {
      id: c.id,
      ref: commitRef(c.repository.fullName, c.sha),
      repo: repoRef(c.repository),
      sha: c.sha,
      messageHeadline: c.messageHeadline,
      authoredAt: c.authoredAt.toISOString(),
      additions: c.additions,
      deletions: c.deletions,
      branch: c.branch,
      associatedPrNumber: c.associatedPrNumber,
      url: commitUrl(c.repository.htmlUrl, c.sha, c.repository.integration.provider),
    };
  }

  async commits(
    userId: string,
    query: ActivityListQuery,
  ): Promise<{ items: CommitItem[]; meta: PageMeta }> {
    const range = await this.range(userId, query);
    const rows = await this.prisma.commit.findMany({
      where: {
        userId,
        parentsCount: { lte: 1 },
        repository: this.repoWhere(query),
        ...(query.q ? { messageHeadline: this.titleWhere(query.q) } : {}),
        ...(range ? { authoredAt: range } : {}),
        ...afterCursor('authoredAt', decodeCursor(query.cursor)),
      },
      include: { repository: REPO_SELECT },
      orderBy: [{ authoredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) => row.authoredAt);
    return { meta: page.meta, items: page.items.map((c) => this.commitItem(c)) };
  }

  async commit(userId: string, id: string): Promise<CommitDetail> {
    const row = await this.prisma.commit.findFirst({
      where: { id, userId, repository: { included: true } },
      include: { repository: REPO_SELECT },
    });
    if (!row) throw AppException.notFound('Commit');
    return { ...this.commitItem(row), messageBody: row.messageBody };
  }

  // ── Issues (Jira / Linear, P13) ────────────────────────────────────────────────────────

  private issueItem(
    i: Prisma.IssueGetPayload<{ include: { integration: { select: { provider: true } } } }>,
    timezone: string,
  ): IssueItem {
    return {
      id: i.id,
      ref: issueRef(i.integration.provider, i.key),
      provider: i.integration.provider === 'LINEAR' ? 'linear' : 'jira',
      key: i.key,
      title: i.title,
      url: safeUrl(i.url),
      status: i.status.toLowerCase() as IssueItem['status'],
      statusName: i.statusName,
      priority: i.priority.toLowerCase() as IssueItem['priority'],
      storyPoints: i.storyPoints,
      project: { key: i.projectKey, name: i.projectName },
      cycleName: i.cycleName,
      labels: i.labels,
      createdAt: i.createdAtRemote.toISOString(),
      updatedAt: i.updatedAtRemote.toISOString(),
      startedAt: i.startedAt?.toISOString() ?? null,
      completedAt: i.completedAt?.toISOString() ?? null,
      cycleTimeHours:
        i.startedAt && i.completedAt && i.startedAt <= i.completedAt
          ? businessHours(i.startedAt, i.completedAt, timezone)
          : null,
    };
  }

  async issues(
    userId: string,
    query: IssueListQuery,
  ): Promise<{ items: IssueItem[]; meta: PageMeta }> {
    const timezone = await this.timezoneOf(userId);
    const range = await this.range(userId, query, timezone);
    const providers = this.issueProviders(query);
    if (providers.length === 0 || query.repoIds?.length) {
      return { items: [], meta: { nextCursor: null, hasMore: false } };
    }
    const field = query.sort === '-completedAt' ? 'completedAt' : 'updatedAtRemote';
    const rows = await this.prisma.issue.findMany({
      where: {
        userId,
        integration: { provider: { in: providers } },
        ...(query.status ? { status: query.status.toUpperCase() as IssueStatus } : {}),
        ...(query.q
          ? {
              OR: [{ title: this.titleWhere(query.q) }, { key: { equals: query.q.toUpperCase() } }],
            }
          : {}),
        ...(field === 'completedAt' ? { completedAt: { not: null } } : {}),
        ...(range ? { [field]: range } : {}),
        ...afterCursor(field, decodeCursor(query.cursor)),
      },
      include: { integration: { select: { provider: true } } },
      orderBy: [{ [field]: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = toPage(rows, query.limit, (row) =>
      field === 'completedAt' ? (row.completedAt ?? row.updatedAtRemote) : row.updatedAtRemote,
    );
    return { meta: page.meta, items: page.items.map((i) => this.issueItem(i, timezone)) };
  }

  async issue(userId: string, id: string): Promise<IssueDetail> {
    const timezone = await this.timezoneOf(userId);
    const row = await this.prisma.issue.findFirst({
      where: { id, userId },
      include: { integration: { select: { provider: true } } },
    });
    if (!row) throw AppException.notFound('Issue');
    return {
      ...this.issueItem(row, timezone),
      canceledAt: row.canceledAt?.toISOString() ?? null,
      // Achievement evidence links PRs / commits / reviews only (P12 CHECK); none for issues yet.
      achievementIds: [],
    };
  }
}
