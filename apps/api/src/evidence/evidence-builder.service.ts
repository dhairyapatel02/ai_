import {
  PeriodError,
  addDays,
  localRangeToUtc,
  periodSpecContaining,
  resolvePeriod,
  todayIn,
  type ResolvedPeriod,
} from '@devimpact/shared';
import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../common/app-exception';
import { assertWithinHistory } from '../entitlements/entitlements';
import { ImpactScoreService } from '../metrics/impact-score.service';
import { MetricsRepository } from '../metrics/metrics.repository';
import { PrismaService } from '../prisma/prisma.service';
import { ACHIEVEMENT_SOURCE, type AchievementSource } from './achievements';
import {
  buildEvidencePack,
  DOCUMENT_LIMITS,
  type EvidencePack,
  type EvidenceRecords,
  type PackLimits,
  type PrRecord,
} from './evidence-pack';

import type { ImpactInputs } from '../metrics/score-inputs';

const REPO_SELECT = {
  select: {
    fullName: true,
    isPrivate: true,
    htmlUrl: true,
    integration: { select: { provider: true } },
  },
} as const;
/** Prisma repository row → pack `RepoRecord` (provider only for GitLab, so GitHub packs stay identical). */
const toRepo = (r: {
  fullName: string;
  isPrivate: boolean;
  htmlUrl: string | null;
  integration: { provider: string };
}) => ({
  fullName: r.fullName,
  isPrivate: r.isPrivate,
  htmlUrl: r.htmlUrl,
  ...(r.integration.provider === 'GITLAB' ? { provider: 'GITLAB' } : {}),
});
const PR_SELECT = {
  id: true,
  number: true,
  title: true,
  body: true,
  url: true,
  state: true,
  labels: true,
  createdAtRemote: true,
  mergedAt: true,
  additions: true,
  deletions: true,
  changedFiles: true,
  commitsCount: true,
  reviewersCount: true,
  changesRequestedCount: true,
  revertedAt: true,
  isRevert: true,
  updatedAtRemote: true,
  syncedAt: true,
  repository: REPO_SELECT,
} as const;

/** Single-item packs (achievement statements) carry no period metrics. */
const ITEM_INPUTS = {
  metrics: {},
  evidence: {},
  evidenceTruncated: {},
  status: 'ok',
} as unknown as ImpactInputs;

/** Volume caps for one load (heavy users); ranking happens on what is loaded, newest first. */
const LOAD_CAPS = { prs: 600, reviews: 600, commits: 400, issues: 300 };

export interface PeriodContext {
  period: ResolvedPeriod;
  timezone: string;
  today: string;
  redactPrivateRepos: boolean;
}

/**
 * Loads the user's records for a period (KPI §2.2 record-set rules: authored PRs are
 * `isAuthoredByUser AND NOT legacyStub`, reviews are on non-authored PRs, included repositories
 * only, no merge commits; reviewed PRs carry no body) plus the period metrics from the impact
 * score cache, and builds the deterministic evidence pack. Never calls the AI.
 */
@Injectable()
export class EvidenceBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scores: ImpactScoreService,
    private readonly metricsRepo: MetricsRepository,
    @Inject(ACHIEVEMENT_SOURCE) private readonly achievements: AchievementSource,
  ) {}

  /**
   * Resolves a period spec in the user's time zone (INVALID_PERIOD on bad ranges). Without a
   * spec, `defaultSpec` decides: the last 12 months ending today (promotion) or the user's
   * default period containing today.
   */
  async context(
    userId: string,
    spec: string | undefined,
    defaultSpec: 'last12months' | 'default' = 'default',
    now = new Date(),
  ): Promise<PeriodContext> {
    const [settings, privacy] = await Promise.all([
      this.metricsRepo.settings(userId),
      this.prisma.userSettings.findUnique({
        where: { userId },
        select: { aiRedactPrivateRepos: true },
      }),
    ]);
    const today = todayIn(settings.timezone, now);
    let effective = spec;
    if (!effective) {
      if (defaultSpec === 'last12months') {
        effective = `custom:${addDays(today, -364)}..${today}`;
      } else {
        const type =
          settings.defaultPeriodType === 'CUSTOM'
            ? 'month'
            : (settings.defaultPeriodType.toLowerCase() as 'month' | 'quarter' | 'half' | 'year');
        effective = periodSpecContaining(type, today);
      }
    }
    try {
      const period = resolvePeriod(effective, settings.timezone, today);
      assertWithinHistory(settings.plan, period.startDate, today);
      return {
        period,
        timezone: settings.timezone,
        today,
        redactPrivateRepos: privacy?.aiRedactPrivateRepos ?? false,
      };
    } catch (error) {
      if (error instanceof PeriodError) {
        throw new AppException('INVALID_PERIOD', error.message, { period: effective });
      }
      throw error;
    }
  }

  async scoreInputs(userId: string, period: ResolvedPeriod): Promise<ImpactInputs> {
    return (await this.scores.scoreFor(userId, period)).inputs;
  }

  async forPeriod(
    userId: string,
    ctx: PeriodContext,
    limits: PackLimits = DOCUMENT_LIMITS,
    inputs?: ImpactInputs,
  ): Promise<EvidencePack> {
    const { start, endExclusive } = localRangeToUtc(
      ctx.period.startDate,
      ctx.period.endDate,
      ctx.period.timezone,
    );
    const [records, scoreInputs] = await Promise.all([
      this.loadRecords(userId, ctx.period, start, endExclusive),
      inputs ? Promise.resolve(inputs) : this.scoreInputs(userId, ctx.period),
    ]);
    return buildEvidencePack({
      period: ctx.period,
      records,
      inputs: scoreInputs,
      redactPrivateRepos: ctx.redactPrivateRepos,
      limits,
    });
  }

  /** One authored PR or commit of the user (achievement statement); 404 otherwise. */
  async forItem(
    userId: string,
    ctx: PeriodContext,
    source: { kind: 'pull_request' | 'commit'; id: string },
  ): Promise<{ pack: EvidencePack; title: string }> {
    const records: EvidenceRecords = { prs: [], reviews: [], commits: [], achievements: [] };
    let title: string;
    if (source.kind === 'pull_request') {
      const pr = await this.prisma.pullRequest.findFirst({
        where: { id: source.id, userId, isAuthoredByUser: true, legacyStub: false },
        select: PR_SELECT,
      });
      if (!pr) throw AppException.notFound('Pull request');
      records.prs.push(this.toPr(pr));
      title = pr.title;
    } else {
      const c = await this.prisma.commit.findFirst({
        where: { id: source.id, userId },
        select: {
          id: true,
          sha: true,
          messageHeadline: true,
          messageBody: true,
          authoredAt: true,
          additions: true,
          deletions: true,
          repository: REPO_SELECT,
        },
      });
      if (!c) throw AppException.notFound('Commit');
      records.commits.push({
        id: c.id,
        sha: c.sha,
        headline: c.messageHeadline,
        body: c.messageBody,
        authoredAt: c.authoredAt,
        additions: c.additions,
        deletions: c.deletions,
        associatedPrNumber: null,
        updatedAt: c.authoredAt,
        repo: toRepo(c.repository),
      });
      title = c.messageHeadline;
    }
    return {
      pack: buildEvidencePack({
        period: ctx.period,
        records,
        inputs: ITEM_INPUTS,
        redactPrivateRepos: ctx.redactPrivateRepos,
        limits: { prs: 1, reviews: 0, commits: 1, achievements: 0 },
        metricKeys: [],
      }),
      title,
    };
  }

  private toPr(pr: {
    id: string;
    number: number;
    title: string;
    body: string | null;
    url: string | null;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    labels: string[];
    createdAtRemote: Date;
    mergedAt: Date | null;
    additions: number | null;
    deletions: number | null;
    changedFiles: number | null;
    commitsCount: number | null;
    reviewersCount: number | null;
    changesRequestedCount: number | null;
    revertedAt: Date | null;
    isRevert: boolean;
    updatedAtRemote: Date | null;
    syncedAt: Date;
    repository: {
      fullName: string;
      isPrivate: boolean;
      htmlUrl: string | null;
      integration: { provider: string };
    };
  }): PrRecord {
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      url: pr.url,
      state: pr.state,
      labels: pr.labels,
      createdAt: pr.createdAtRemote,
      mergedAt: pr.mergedAt,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      commitsCount: pr.commitsCount,
      reviewersCount: pr.reviewersCount,
      changesRequestedCount: pr.changesRequestedCount,
      revertedAt: pr.revertedAt,
      isRevert: pr.isRevert,
      updatedAt: pr.updatedAtRemote ?? pr.mergedAt ?? pr.createdAtRemote,
      repo: toRepo(pr.repository),
    };
  }

  private async loadRecords(
    userId: string,
    period: ResolvedPeriod,
    start: Date,
    end: Date,
  ): Promise<EvidenceRecords> {
    const range = { gte: start, lt: end };
    const [prs, reviews, commits, achievements, issues] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where: {
          userId,
          isAuthoredByUser: true,
          legacyStub: false,
          repository: { included: true },
          OR: [{ mergedAt: range }, { mergedAt: null, createdAtRemote: range }],
        },
        select: PR_SELECT,
        orderBy: [{ createdAtRemote: 'desc' }, { id: 'asc' }],
        take: LOAD_CAPS.prs,
      }),
      this.prisma.pullRequestReview.findMany({
        where: {
          userId,
          submittedAt: range,
          pullRequest: {
            isAuthoredByUser: false,
            legacyStub: false,
            repository: { included: true },
          },
        },
        select: {
          id: true,
          state: true,
          submittedAt: true,
          commentsCount: true,
          hasBody: true,
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
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        take: LOAD_CAPS.reviews,
      }),
      this.prisma.commit.findMany({
        where: {
          userId,
          authoredAt: range,
          parentsCount: { lte: 1 },
          repository: { included: true },
        },
        select: {
          id: true,
          sha: true,
          messageHeadline: true,
          messageBody: true,
          authoredAt: true,
          additions: true,
          deletions: true,
          associatedPrNumber: true,
          repository: REPO_SELECT,
        },
        orderBy: [{ authoredAt: 'desc' }, { id: 'asc' }],
        take: LOAD_CAPS.commits,
      }),
      this.achievements.listForPeriod(userId, period.startDate, period.endDate),
      // Jira / Linear issues completed in the period (P13).
      this.prisma.issue.findMany({
        where: { userId, status: 'DONE', completedAt: range },
        select: {
          id: true,
          key: true,
          title: true,
          url: true,
          status: true,
          priority: true,
          storyPoints: true,
          labels: true,
          projectName: true,
          cycleName: true,
          completedAt: true,
          updatedAtRemote: true,
          updatedAt: true,
          integration: { select: { provider: true } },
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
        take: LOAD_CAPS.issues,
      }),
    ]);
    return {
      prs: prs.map((pr) => this.toPr(pr)),
      reviews: reviews.map((r) => ({
        id: r.id,
        state: r.state,
        submittedAt: r.submittedAt,
        commentsCount: r.commentsCount,
        hasBody: r.hasBody,
        updatedAt: r.submittedAt,
        pr: {
          id: r.pullRequest.id,
          number: r.pullRequest.number,
          title: r.pullRequest.title,
          url: r.pullRequest.url,
          authorLogin: r.pullRequest.authorLogin,
        },
        repo: toRepo(r.pullRequest.repository),
      })),
      commits: commits.map((c) => ({
        id: c.id,
        sha: c.sha,
        headline: c.messageHeadline,
        body: c.messageBody,
        authoredAt: c.authoredAt,
        additions: c.additions,
        deletions: c.deletions,
        associatedPrNumber: c.associatedPrNumber,
        updatedAt: c.authoredAt,
        repo: c.repository,
      })),
      achievements,
      ...(issues.length > 0
        ? {
            issues: issues.map((i) => ({
              id: i.id,
              provider:
                i.integration.provider === 'LINEAR' ? ('LINEAR' as const) : ('JIRA' as const),
              key: i.key,
              title: i.title,
              url: i.url,
              status: i.status,
              priority: i.priority,
              storyPoints: i.storyPoints,
              labels: i.labels,
              projectName: i.projectName,
              cycleName: i.cycleName,
              completedAt: i.completedAt,
              updatedAtRemote: i.updatedAtRemote,
              updatedAt: i.updatedAt,
            })),
          }
        : {}),
    };
  }
}
