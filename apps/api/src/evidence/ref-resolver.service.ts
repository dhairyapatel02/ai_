import { Injectable } from '@nestjs/common';

import { commitRef, commitUrl, prRef, reviewRef, safeUrl } from '../common/evidence-refs';
import { PrismaService } from '../prisma/prisma.service';

import type { EvidenceItem } from '@devimpact/shared';

const MAX_REFS = 300;
const REF = /^(PR|REV|C)-(.+?)(?:#(\d+)|@([0-9a-f]{7,40}))$/;

/**
 * Resolves evidence refs (`PR-<repo>#n`, `REV-<repo>#n`, `C-<repo>@sha7`) to titled, linkable
 * items for the user (A-3). Unknown refs (purged data, other users' records) are skipped.
 */
@Injectable()
export class RefResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, refs: string[]): Promise<EvidenceItem[]> {
    const wanted = [...new Set(refs)].slice(0, MAX_REFS);
    const prKeys: { repo: string; number: number }[] = [];
    const revKeys: { repo: string; number: number }[] = [];
    const commitKeys: { repo: string; sha: string }[] = [];
    for (const ref of wanted) {
      const m = REF.exec(ref);
      if (!m) continue;
      const [, kind, repo, number, sha] = m;
      if (kind === 'PR' && number) prKeys.push({ repo, number: Number(number) });
      else if (kind === 'REV' && number) revKeys.push({ repo, number: Number(number) });
      else if (kind === 'C' && sha) commitKeys.push({ repo, sha });
    }
    const repo = { select: { fullName: true, htmlUrl: true } } as const;
    const [prs, reviews, commits] = await Promise.all([
      prKeys.length === 0
        ? []
        : this.prisma.pullRequest.findMany({
            where: {
              userId,
              OR: prKeys.map((k) => ({ number: k.number, repository: { fullName: k.repo } })),
            },
            select: {
              id: true,
              number: true,
              title: true,
              url: true,
              createdAtRemote: true,
              mergedAt: true,
              repository: repo,
            },
          }),
      revKeys.length === 0
        ? []
        : this.prisma.pullRequestReview.findMany({
            where: {
              userId,
              OR: revKeys.map((k) => ({
                pullRequest: { number: k.number, repository: { fullName: k.repo } },
              })),
            },
            select: {
              id: true,
              submittedAt: true,
              pullRequest: { select: { number: true, title: true, url: true, repository: repo } },
            },
            orderBy: { submittedAt: 'desc' },
          }),
      commitKeys.length === 0
        ? []
        : this.prisma.commit.findMany({
            where: {
              userId,
              OR: commitKeys.map((k) => ({
                sha: { startsWith: k.sha },
                repository: { fullName: k.repo },
              })),
            },
            select: {
              id: true,
              sha: true,
              messageHeadline: true,
              authoredAt: true,
              repository: repo,
            },
          }),
    ]);
    const byRef = new Map<string, EvidenceItem>();
    for (const p of prs) {
      const ref = prRef(p.repository.fullName, p.number);
      byRef.set(ref, {
        ref,
        kind: 'pull_request',
        id: p.id,
        title: p.title,
        repo: p.repository.fullName,
        url: safeUrl(p.url),
        occurredAt: (p.mergedAt ?? p.createdAtRemote).toISOString(),
      });
    }
    for (const r of reviews) {
      const ref = reviewRef(r.pullRequest.repository.fullName, r.pullRequest.number);
      if (byRef.has(ref)) continue; // newest review per PR
      byRef.set(ref, {
        ref,
        kind: 'review',
        id: r.id,
        title: r.pullRequest.title,
        repo: r.pullRequest.repository.fullName,
        url: safeUrl(r.pullRequest.url),
        occurredAt: r.submittedAt.toISOString(),
      });
    }
    for (const c of commits) {
      const ref = commitRef(c.repository.fullName, c.sha);
      byRef.set(ref, {
        ref,
        kind: 'commit',
        id: c.id,
        title: c.messageHeadline,
        repo: c.repository.fullName,
        url: commitUrl(c.repository.htmlUrl, c.sha),
        occurredAt: c.authoredAt.toISOString(),
      });
    }
    return wanted.map((ref) => byRef.get(ref)).filter((x): x is EvidenceItem => x !== undefined);
  }
}
