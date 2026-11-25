import { type EvidenceItem, type ImplementedMetricKey } from '@devimpact/shared';

import {
  REPO_PROVIDER,
  commitRef,
  commitUrl,
  issueRef,
  prRef,
  reviewRef,
  safeUrl,
} from '../common/evidence-refs';

import type { PrismaService } from '../prisma/prisma.service';

/** Which PR timestamp a metric's evidence refers to (display only; order comes from the engine). */
function prTimestamp(
  metric: ImplementedMetricKey,
  pr: { createdAtRemote: Date; mergedAt: Date | null; firstReviewAt: Date | null },
): Date {
  switch (metric) {
    case 'prs_opened':
    case 'active_days':
    case 'active_weeks_ratio':
    case 'longest_active_week_streak':
      return pr.createdAtRemote;
    case 'time_to_first_review_median_hours':
      return pr.firstReviewAt ?? pr.createdAtRemote;
    default:
      return pr.mergedAt ?? pr.createdAtRemote;
  }
}

/**
 * Resolves a metric's evidence ids (PR, review or commit cuids; KPI_METHODOLOGY §7) to titled,
 * linkable items in the given order (A-2). Ids that no longer exist (purged) are skipped.
 */
export async function evidenceRefs(
  prisma: PrismaService,
  userId: string,
  metric: ImplementedMetricKey,
  ids: string[],
): Promise<EvidenceItem[]> {
  if (ids.length === 0) return [];
  const repo = { select: { fullName: true, htmlUrl: true, ...REPO_PROVIDER } } as const;
  const [prs, reviews, commits, issues] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { userId, id: { in: ids } },
      select: {
        id: true,
        number: true,
        title: true,
        url: true,
        createdAtRemote: true,
        mergedAt: true,
        firstReviewAt: true,
        repository: repo,
      },
    }),
    prisma.pullRequestReview.findMany({
      where: { userId, id: { in: ids } },
      select: {
        id: true,
        submittedAt: true,
        pullRequest: { select: { number: true, title: true, url: true, repository: repo } },
      },
    }),
    prisma.commit.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, sha: true, messageHeadline: true, authoredAt: true, repository: repo },
    }),
    prisma.issue.findMany({
      where: { userId, id: { in: ids } },
      select: {
        id: true,
        key: true,
        title: true,
        url: true,
        completedAt: true,
        updatedAtRemote: true,
        projectName: true,
        integration: { select: { provider: true } },
      },
    }),
  ]);
  const byId = new Map<string, EvidenceItem>();
  for (const p of prs) {
    byId.set(p.id, {
      ref: prRef(p.repository.fullName, p.number, p.repository.integration.provider),
      kind: 'pull_request',
      id: p.id,
      title: p.title,
      repo: p.repository.fullName,
      url: safeUrl(p.url),
      occurredAt: prTimestamp(metric, p).toISOString(),
    });
  }
  for (const r of reviews) {
    byId.set(r.id, {
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
    });
  }
  for (const c of commits) {
    byId.set(c.id, {
      ref: commitRef(c.repository.fullName, c.sha),
      kind: 'commit',
      id: c.id,
      title: c.messageHeadline,
      repo: c.repository.fullName,
      url: commitUrl(c.repository.htmlUrl, c.sha, c.repository.integration.provider),
      occurredAt: c.authoredAt.toISOString(),
    });
  }
  for (const i of issues) {
    byId.set(i.id, {
      ref: issueRef(i.integration.provider, i.key),
      kind: 'issue',
      id: i.id,
      title: i.title,
      repo: i.projectName,
      url: safeUrl(i.url),
      occurredAt: (i.completedAt ?? i.updatedAtRemote).toISOString(),
    });
  }
  return ids.map((id) => byId.get(id)).filter((item): item is EvidenceItem => item !== undefined);
}
