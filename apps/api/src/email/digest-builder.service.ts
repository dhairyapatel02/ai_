import {
  addDays,
  localRangeToUtc,
  metricMeta,
  resolvePeriod,
  startOfIsoWeek,
  todayIn,
  type ImplementedMetricKey,
} from '@devimpact/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { prRef, safeUrl } from '../common/evidence-refs';
import { ImpactScoreService } from '../metrics/impact-score.service';
import { PrismaService } from '../prisma/prisma.service';
import { createUnsubscribeToken } from './unsubscribe-token';

import type { Env } from '../config/env';
import type { DigestContent } from './digest-template';

/** Engine metrics shown in the digest (KPI_METHODOLOGY §8: numbers only from the engine). */
export const DIGEST_METRICS: ImplementedMetricKey[] = [
  'prs_merged',
  'prs_reviewed',
  'commits',
  'repos_contributed',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (date: string) =>
  `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${Number(date.slice(8, 10))}`;

/** `Nov 16 – Nov 22` (year appended when the week spans two years). */
export function weekLabel(start: string, end: string): string {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${short(start)} – ${short(end)}`
    : `${short(start)}, ${start.slice(0, 4)} – ${short(end)}, ${end.slice(0, 4)}`;
}

/** Monday of the last complete ISO week before `today` (local date). */
export function lastCompleteWeekStart(today: string): string {
  return addDays(startOfIsoWeek(today), -7);
}

/**
 * Builds the deterministic part of a weekly digest (F-63): engine metrics for the week and the
 * week before, notable merged PRs, merged PRs not yet captured as achievements, achievements
 * logged, and the links (dashboard, settings, signed unsubscribe). No AI here — the optional
 * summary is added by the worker (`DigestSummaryService`).
 */
@Injectable()
export class DigestBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scores: ImpactScoreService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  unsubscribeUrl(userId: string, now = new Date()): string {
    const token = createUnsubscribeToken(
      this.config.get('UNSUBSCRIBE_TOKEN_SECRET', { infer: true }),
      { userId, list: 'digest' },
      this.config.get('UNSUBSCRIBE_TOKEN_TTL_DAYS', { infer: true }),
      now,
    );
    return `${this.webUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  private webUrl(): string {
    return this.config.get('WEB_URL', { infer: true }).replace(/\/+$/, '');
  }

  /** Returns null when the user no longer exists. `empty` = nothing happened that week. */
  async build(
    userId: string,
    weekStart: string,
    now = new Date(),
  ): Promise<{ content: DigestContent; email: string; empty: boolean } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, settings: { select: { timezone: true } } },
    });
    if (!user) return null;
    const timezone = user.settings?.timezone ?? 'UTC';
    const today = todayIn(timezone, now);
    const weekEnd = addDays(weekStart, 6);
    const prevStart = addDays(weekStart, -7);
    const week = resolvePeriod(`custom:${weekStart}..${weekEnd}`, timezone, today);
    const prev = resolvePeriod(`custom:${prevStart}..${addDays(prevStart, 6)}`, timezone, today);
    const [current, previous] = await this.scores.scoresFor(userId, [week, prev]);
    const value = (inputs: typeof current.inputs | undefined, key: ImplementedMetricKey) =>
      inputs?.metrics[key]?.value ?? 0;

    const { start, endExclusive } = localRangeToUtc(weekStart, weekEnd, timezone);
    const [merged, achievementsLogged] = await Promise.all([
      this.prisma.pullRequest.findMany({
        where: {
          userId,
          isAuthoredByUser: true,
          legacyStub: false,
          repository: { included: true },
          mergedAt: { gte: start, lt: endExclusive },
        },
        select: {
          id: true,
          number: true,
          title: true,
          url: true,
          additions: true,
          deletions: true,
          repository: { select: { fullName: true, integration: { select: { provider: true } } } },
          evidence: { where: { achievement: { userId } }, select: { id: true }, take: 1 },
        },
        orderBy: [{ mergedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
      this.prisma.achievement.count({
        where: {
          userId,
          occurredOn: {
            gte: new Date(`${weekStart}T00:00:00Z`),
            lte: new Date(`${weekEnd}T00:00:00Z`),
          },
        },
      }),
    ]);
    const size = (p: (typeof merged)[number]) => (p.additions ?? 0) + (p.deletions ?? 0);
    const bySize = [...merged].sort((a, b) => size(b) - size(a) || (a.id < b.id ? -1 : 1));
    const toItem = (p: (typeof merged)[number], url: string | null) => ({
      title: p.title,
      repo: p.repository.fullName,
      ref: prRef(p.repository.fullName, p.number, p.repository.integration.provider),
      url,
    });
    const web = this.webUrl();
    const notable = bySize.slice(0, 3).map((p) => toItem(p, safeUrl(p.url)));
    const suggestions = bySize
      .filter((p) => p.evidence.length === 0)
      .slice(0, 2)
      .map((p) => toItem(p, `${web}/activity?item=${encodeURIComponent(`pr_merged:${p.id}`)}`));

    const metrics = DIGEST_METRICS.map((key) => ({
      key,
      label: metricMeta(key).label,
      value: value(current?.inputs, key),
      previous: previous ? value(previous.inputs, key) : null,
    }));
    const empty =
      merged.length === 0 && achievementsLogged === 0 && metrics.every((m) => m.value === 0);
    return {
      email: user.email,
      empty,
      content: {
        name: user.name,
        timezone,
        weekStart,
        weekEnd,
        weekLabel: weekLabel(weekStart, weekEnd),
        metrics,
        notable,
        suggestions,
        achievementsLogged,
        summary: null,
        links: {
          dashboard: `${web}/dashboard`,
          achievements: `${web}/achievements`,
          settings: `${web}/settings/notifications`,
          unsubscribe: this.unsubscribeUrl(userId, now),
        },
      },
    };
  }
}
