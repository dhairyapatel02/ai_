import { Injectable } from '@nestjs/common';

import {
  REPO_PROVIDER,
  commitRef,
  commitUrl,
  issueRef,
  prRef,
  reviewRef,
  safeUrl,
} from '../common/evidence-refs';
import { PrismaService } from '../prisma/prisma.service';

import type { EvidenceItem } from '@devimpact/shared';

const MAX_REFS = 300;
const REF = /^(PR|MR|REV|C)-(.+?)(?:[#!](\d+)|@([0-9a-f]{7,40}))$/;
/** `JIRA-ABC-123` / `LIN-ENG-42` (P13). */
const ISSUE_REF = /^(JIRA|LIN)-([A-Z][A-Z0-9_]{0,29}-\d{1,9})$/;
const ACH_REF = /^ACH-(c[0-9a-z]{20,31})$/;

/**
 * Resolves evidence refs (`PR-<repo>#n`, `MR-<project>!n`, `REV-<repo>#n|!n`, `C-<repo>@sha7`,
 * `ACH-<id>`, `JIRA-<KEY>`, `LIN-<KEY>`) to titled,
 * linkable items for the user (A-3). Unknown refs (purged data, other users' records) are skipped.
 * Achievements carry no URL (the web links them to the Activity drawer, GAP-18).
 */
@Injectable()
export class RefResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, refs: string[]): Promise<EvidenceItem[]> {
    const wanted = [...new Set(refs)].slice(0, MAX_REFS);
    const prKeys: { repo: string; number: number }[] = [];
    const revKeys: { repo: string; number: number }[] = [];
    const commitKeys: { repo: string; sha: string }[] = [];
    const achievementIds: string[] = [];
    const issueKeys: { provider: 'JIRA' | 'LINEAR'; key: string }[] = [];
    for (const ref of wanted) {
      const issue = ISSUE_REF.exec(ref);
      if (issue?.[2]) {
        issueKeys.push({ provider: issue[1] === 'LIN' ? 'LINEAR' : 'JIRA', key: issue[2] });
        continue;
      }
      const ach = ACH_REF.exec(ref);
      if (ach?.[1]) {
        achievementIds.push(ach[1]);
        continue;
      }
      const m = REF.exec(ref);
      if (!m) continue;
      const [, kind, repo, number, sha] = m;
      if ((kind === 'PR' || kind === 'MR') && number) prKeys.push({ repo, number: Number(number) });
      else if (kind === 'REV' && number) revKeys.push({ repo, number: Number(number) });
      else if (kind === 'C' && sha) commitKeys.push({ repo, sha });
    }
    const repo = { select: { fullName: true, htmlUrl: true, ...REPO_PROVIDER } } as const;
    const [prs, reviews, commits, achievements, issues] = await Promise.all([
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
      achievementIds.length === 0
        ? []
        : this.prisma.achievement.findMany({
            where: { userId, id: { in: achievementIds } },
            select: { id: true, title: true, occurredOn: true },
          }),
      issueKeys.length === 0
        ? []
        : this.prisma.issue.findMany({
            where: {
              userId,
              OR: issueKeys.map((k) => ({ key: k.key, integration: { provider: k.provider } })),
            },
            select: {
              id: true,
              key: true,
              title: true,
              url: true,
              projectName: true,
              completedAt: true,
              updatedAtRemote: true,
              integration: { select: { provider: true } },
            },
            // Same key on two Jira sites: the most recently updated one wins (documented).
            orderBy: { updatedAtRemote: 'asc' },
          }),
    ]);
    const byRef = new Map<string, EvidenceItem>();
    for (const p of prs) {
      const ref = prRef(p.repository.fullName, p.number, p.repository.integration.provider);
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
      const ref = reviewRef(
        r.pullRequest.repository.fullName,
        r.pullRequest.number,
        r.pullRequest.repository.integration.provider,
      );
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
        url: commitUrl(c.repository.htmlUrl, c.sha, c.repository.integration.provider),
        occurredAt: c.authoredAt.toISOString(),
      });
    }
    for (const a of achievements) {
      const ref = `ACH-${a.id}`;
      byRef.set(ref, {
        ref,
        kind: 'achievement',
        id: a.id,
        title: a.title,
        repo: null,
        url: null,
        occurredAt: `${a.occurredOn.toISOString().slice(0, 10)}T12:00:00.000Z`,
      });
    }
    for (const i of issues) {
      const ref = issueRef(i.integration.provider, i.key);
      byRef.set(ref, {
        ref,
        kind: 'issue',
        id: i.id,
        title: i.title,
        repo: i.projectName,
        url: safeUrl(i.url),
        occurredAt: (i.completedAt ?? i.updatedAtRemote).toISOString(),
      });
    }
    return wanted.map((ref) => byRef.get(ref)).filter((x): x is EvidenceItem => x !== undefined);
  }
}
