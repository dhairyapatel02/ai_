import {
  IMPLEMENTED_METRIC_KEYS,
  metricMeta,
  type ImplementedMetricKey,
  type MetricValue,
  type ResolvedPeriod,
} from '@devimpact/shared';

import { cleanText, TEXT_CAPS } from '../ai/template';
import { commitRef, prRef, reviewRef } from '../common/evidence-refs';

import type { ImpactInputs } from '../metrics/score-inputs';
import type { AchievementRecord } from './achievements';

/**
 * Deterministic evidence selection for AI documents (ADR-0009, KPI §8: "selecting which PRs are
 * significant — never the LLM"). Pure: the same records + score inputs always give the same
 * pack, which is what makes `inputHash` caching and the evals reproducible.
 */

export interface PrRecord {
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  labels: string[];
  createdAt: Date;
  mergedAt: Date | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commitsCount: number | null;
  reviewersCount: number | null;
  changesRequestedCount: number | null;
  revertedAt: Date | null;
  isRevert: boolean;
  updatedAt: Date;
  repo: RepoRecord;
}

export interface RepoRecord {
  fullName: string;
  isPrivate: boolean;
  htmlUrl: string | null;
}

export interface ReviewRecord {
  id: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  submittedAt: Date;
  commentsCount: number;
  hasBody: boolean;
  updatedAt: Date;
  pr: { id: string; number: number; title: string; url: string | null; authorLogin: string | null };
  repo: RepoRecord;
}

export interface CommitRecord {
  id: string;
  sha: string;
  headline: string;
  body: string | null;
  authoredAt: Date;
  additions: number;
  deletions: number;
  associatedPrNumber: number | null;
  updatedAt: Date;
  repo: RepoRecord;
}

export interface EvidenceRecords {
  prs: PrRecord[];
  reviews: ReviewRecord[];
  commits: CommitRecord[];
  achievements: AchievementRecord[];
}

export type EvidenceKindValue = 'pull_request' | 'review' | 'commit' | 'achievement';

export interface PackItem {
  /** Real ref (stored citations, UI chips). */
  ref: string;
  /** Ref shown to the model (alias when the repo is redacted, F-76). */
  promptRef: string;
  kind: EvidenceKindValue;
  id: string;
  title: string;
  repo: string | null;
  /** Repository name shown to the model (neutral label when redacted). */
  repoLabel: string | null;
  url: string | null;
  occurredAt: string;
  /** Change marker for the cache key (`syncedAt` / `updatedAt`). */
  version: string;
  score: number;
  tags: string[];
  /** Model-facing facts (sizes, review depth, excerpt), already cleaned and capped. */
  facts: Record<string, string | number | boolean | string[] | null>;
}

export interface PackMetric {
  key: ImplementedMetricKey;
  label: string;
  unit: string;
  value: number | null;
  n: number;
  status: string;
  /** Exactly how the model must write the number (if it writes it at all). */
  display: string | null;
}

export interface EvidencePack {
  period: ResolvedPeriod;
  items: PackItem[];
  metrics: PackMetric[];
  /** Engine values for engine-filled sections (`metrics`, `supportingData`). */
  metricValues: MetricValue[];
  counts: {
    prsMerged: number;
    prsReviewed: number;
    commits: number;
    repos: number;
    achievements: number;
  };
  themes: { theme: string; refs: string[] }[];
  scoreStatus: 'ok' | 'insufficient_data';
  redacted: boolean;
  /** Impact score context (impact narrative only); its numbers are citable in prose. */
  score?: {
    overall: number | null;
    band: string | null;
    dimensions: { label: string; score: number | null }[];
  };
}

export interface PackLimits {
  prs: number;
  reviews: number;
  commits: number;
  achievements: number;
}

export const DOCUMENT_LIMITS: PackLimits = { prs: 40, reviews: 15, commits: 10, achievements: 20 };

/** Metrics shown in engine-filled document sections (KPI §3, scored + key informational). */
export const DOCUMENT_METRICS: ImplementedMetricKey[] = [
  'prs_merged',
  'pr_cycle_time_median_hours',
  'small_pr_ratio',
  'revert_rate',
  'first_pass_approval_rate',
  'prs_reviewed',
  'review_turnaround_median_hours',
  'review_depth_median',
  'repos_contributed',
  'two_way_repos',
  'active_days',
  'commits',
];

const TAG_RULES: [string, RegExp][] = [
  ['incident', /\b(incident|outage|hotfix|sev[0-9]|postmortem)\b/i],
  ['performance', /\b(perf|performance|latency|faster|speed ?up|optimi[sz]e|cache|caching)\b/i],
  ['security', /\b(security|vuln|cve|auth|xss|csrf|injection|secret)\b/i],
  ['reliability', /\b(retry|retries|flaky|resilien|timeout|reliab)\w*/i],
  ['testing', /\b(test|tests|testing|e2e|coverage)\b/i],
  ['bugfix', /\b(fix|fixes|bug|regression)\b/i],
  ['refactor', /\b(refactor|cleanup|clean up|simplif)\w*/i],
  ['docs', /\b(docs?|documentation|readme)\b/i],
  ['feature', /\b(feat|feature|add|adds|introduce|support|launch|ship)\w*/i],
  ['infra', /\b(ci|cd|deploy|docker|k8s|kubernetes|terraform|infra|pipeline)\b/i],
];

export function tagsOf(text: string, labels: string[] = []): string[] {
  const hay = `${text} ${labels.join(' ')}`;
  return TAG_RULES.filter(([, re]) => re.test(hay)).map(([tag]) => tag);
}

const TAG_BONUS: Record<string, number> = {
  incident: 1.5,
  performance: 1.2,
  security: 1.2,
  reliability: 0.8,
  feature: 0.5,
  testing: 0.3,
  bugfix: 0.3,
};

function sizeBand(lines: number | null): number {
  if (lines === null) return 0.8;
  if (lines < 50) return 0.5;
  if (lines < 400) return 1.5;
  if (lines < 1000) return 2;
  return 1.5; // very large PRs are not rewarded further (anti-gaming, KPI §3)
}

/** PR significance (ADR-0009): merged, size band, reviewers, review depth, labels. */
export function scorePr(pr: PrRecord): number {
  const lines = pr.additions === null || pr.deletions === null ? null : pr.additions + pr.deletions;
  const tags = tagsOf(pr.title, pr.labels);
  let score = pr.mergedAt ? 3 : pr.state === 'OPEN' ? 1 : 0.5;
  score += sizeBand(lines);
  score += Math.min(2, (pr.reviewersCount ?? 0) * 0.5);
  score += Math.min(1, (pr.changesRequestedCount ?? 0) * 0.25);
  score += Math.min(1, Math.log2(1 + (pr.commitsCount ?? 1)) * 0.3);
  score += tags.reduce((sum, t) => sum + (TAG_BONUS[t] ?? 0), 0);
  if (pr.body && pr.body.trim().length > 40) score += 0.3;
  if (pr.revertedAt) score -= 3;
  if (pr.isRevert) score -= 1;
  return Math.round(score * 1000) / 1000;
}

export function scoreReview(r: ReviewRecord): number {
  let score = 1 + Math.min(10, r.commentsCount) * 0.2;
  if (r.hasBody) score += 0.3;
  if (r.state === 'CHANGES_REQUESTED') score += 0.5;
  score += tagsOf(r.pr.title).reduce((sum, t) => sum + (TAG_BONUS[t] ?? 0) / 2, 0);
  return Math.round(score * 1000) / 1000;
}

export function scoreCommit(c: CommitRecord): number {
  const lines = c.additions + c.deletions;
  const tags = tagsOf(`${c.headline} ${c.body ?? ''}`);
  let score = 0.5 + (lines > 20 && lines < 800 ? 0.5 : 0);
  score += tags.reduce((sum, t) => sum + (TAG_BONUS[t] ?? 0) / 2, 0);
  return Math.round(score * 1000) / 1000;
}

const byScore = <T extends { score: number; occurredAt: string; id: string }>(a: T, b: T) =>
  b.score - a.score ||
  (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0) ||
  (a.id < b.id ? -1 : 1);

/** Display string for a metric value (the only form a number may appear in prose). */
export function formatMetric(unit: string, value: number | null): string | null {
  if (value === null) return null;
  switch (unit) {
    case 'ratio':
      return `${Math.round(value * 100)}%`;
    case 'hours':
      return `${Math.round(value * 10) / 10} hours`;
    default:
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  }
}

export function packMetrics(inputs: ImpactInputs, keys?: ImplementedMetricKey[]): PackMetric[] {
  // Fixed catalogue order: stored inputs come back from JSONB with reordered keys.
  const all = (keys ?? IMPLEMENTED_METRIC_KEYS).filter((k) => inputs.metrics[k] !== undefined);
  return all.map((key) => {
    const m = inputs.metrics[key];
    const meta = metricMeta(key);
    const ok = m.status === 'ok';
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      value: ok ? m.value : null,
      n: m.n,
      status: m.status,
      display: ok ? formatMetric(meta.unit, m.value) : null,
    };
  });
}

const EVIDENCE_IN_DOCUMENT = 20;

/** Engine values for document sections (current period; evidence ids capped for size). */
export function metricValuesFor(inputs: ImpactInputs, keys: ImplementedMetricKey[]): MetricValue[] {
  return keys.map((key) => {
    const meta = metricMeta(key);
    const m = inputs.metrics[key];
    const ids = inputs.evidence[key] ?? [];
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      value: m.value,
      n: m.n,
      status: m.status,
      previousValue: null,
      delta: null,
      deltaPct: null,
      direction: meta.direction,
      inScore: meta.inScore,
      evidence: ids.slice(0, EVIDENCE_IN_DOCUMENT),
      evidenceTruncated:
        ids.length > EVIDENCE_IN_DOCUMENT || (inputs.evidenceTruncated[key] ?? false),
    };
  });
}

function repoAliases(records: EvidenceRecords, redact: boolean): Map<string, string> {
  const names = new Set<string>();
  if (redact) {
    for (const r of [...records.prs, ...records.reviews, ...records.commits]) {
      if (r.repo.isPrivate) names.add(r.repo.fullName);
    }
  }
  return new Map([...names].sort().map((name, i) => [name, `private/repo-${i + 1}`]));
}

export interface BuildPackInput {
  period: ResolvedPeriod;
  records: EvidenceRecords;
  inputs: ImpactInputs;
  redactPrivateRepos: boolean;
  limits?: PackLimits;
  metricKeys?: ImplementedMetricKey[];
}

export function buildEvidencePack(input: BuildPackInput): EvidencePack {
  const { records, inputs, period } = input;
  const limits = input.limits ?? DOCUMENT_LIMITS;
  const aliases = repoAliases(records, input.redactPrivateRepos);
  const label = (fullName: string) => aliases.get(fullName) ?? fullName;

  const prItems: PackItem[] = records.prs.map((pr) => {
    const lines =
      pr.additions === null || pr.deletions === null ? null : pr.additions + pr.deletions;
    return {
      ref: prRef(pr.repo.fullName, pr.number),
      promptRef: prRef(label(pr.repo.fullName), pr.number),
      kind: 'pull_request',
      id: pr.id,
      title: cleanText(pr.title, TEXT_CAPS.title),
      repo: pr.repo.fullName,
      repoLabel: label(pr.repo.fullName),
      url: pr.url,
      occurredAt: (pr.mergedAt ?? pr.createdAt).toISOString(),
      version: pr.updatedAt.toISOString(),
      score: scorePr(pr),
      tags: tagsOf(pr.title, pr.labels),
      facts: {
        state: pr.mergedAt ? 'merged' : pr.state.toLowerCase(),
        changedLines: lines,
        changedFiles: pr.changedFiles,
        reviewers: pr.reviewersCount,
        labels: pr.labels.slice(0, 8).map((l) => cleanText(l, 50)),
        reverted: pr.revertedAt !== null,
        description: null,
      },
    };
  });
  const prsRanked = prItems.sort(byScore).slice(0, limits.prs);
  // Longer excerpts for the most significant PRs (≤ ~60k tokens overall, ADR-0009).
  const bodyById = new Map(records.prs.map((p) => [p.id, p.body]));
  prsRanked.forEach((item, i) => {
    item.facts.description =
      cleanText(bodyById.get(item.id), i < 15 ? TEXT_CAPS.body / 2 : 300) || null;
  });

  const reviewItems: PackItem[] = records.reviews.map((r) => ({
    ref: reviewRef(r.repo.fullName, r.pr.number),
    promptRef: reviewRef(label(r.repo.fullName), r.pr.number),
    kind: 'review',
    id: r.id,
    title: cleanText(r.pr.title, TEXT_CAPS.title),
    repo: r.repo.fullName,
    repoLabel: label(r.repo.fullName),
    url: r.pr.url,
    occurredAt: r.submittedAt.toISOString(),
    version: r.updatedAt.toISOString(),
    score: scoreReview(r),
    tags: tagsOf(r.pr.title),
    facts: {
      reviewState: r.state.toLowerCase(),
      inlineComments: r.commentsCount,
      wroteSummary: r.hasBody,
    },
  }));
  // One review per reviewed PR (the most substantial), so refs are unique.
  const reviewsByRef = new Map<string, PackItem>();
  for (const item of reviewItems.sort(byScore)) {
    if (!reviewsByRef.has(item.ref)) reviewsByRef.set(item.ref, item);
  }
  const reviewsRanked = [...reviewsByRef.values()].slice(0, limits.reviews);

  // Commits already represented by a selected PR add nothing.
  const selectedPrKeys = new Set(prsRanked.map((p) => p.ref));
  const commitItems: PackItem[] = records.commits
    .filter(
      (c) =>
        c.associatedPrNumber === null ||
        !selectedPrKeys.has(prRef(c.repo.fullName, c.associatedPrNumber)),
    )
    .map((c) => ({
      ref: commitRef(c.repo.fullName, c.sha),
      promptRef: commitRef(label(c.repo.fullName), c.sha),
      kind: 'commit',
      id: c.id,
      title: cleanText(c.headline, TEXT_CAPS.title),
      repo: c.repo.fullName,
      repoLabel: label(c.repo.fullName),
      url: null,
      occurredAt: c.authoredAt.toISOString(),
      version: c.updatedAt.toISOString(),
      score: scoreCommit(c),
      tags: tagsOf(`${c.headline} ${c.body ?? ''}`),
      facts: {
        changedLines: c.additions + c.deletions,
        message: cleanText(c.body, 300) || null,
      },
    }));
  const commitsRanked = commitItems.sort(byScore).slice(0, limits.commits);

  const achievementItems: PackItem[] = records.achievements
    .map((a) => ({
      ref: `ACH-${a.id}`,
      promptRef: `ACH-${a.id}`,
      kind: 'achievement' as const,
      id: a.id,
      title: cleanText(a.title, TEXT_CAPS.title),
      repo: null,
      repoLabel: null,
      url: null,
      occurredAt: `${a.occurredOn}T12:00:00.000Z`,
      version: a.updatedAt.toISOString(),
      score: 2.5,
      tags: [a.category.toLowerCase()],
      facts: {
        category: a.category.toLowerCase(),
        description: cleanText(a.description, 1000) || null,
        impact: cleanText(a.impact, 500) || null,
      },
    }))
    .sort(byScore)
    .slice(0, limits.achievements);

  const items = [...prsRanked, ...achievementItems, ...reviewsRanked, ...commitsRanked];

  const themes = new Map<string, string[]>();
  for (const item of items) {
    const theme = item.repoLabel ?? 'Achievements';
    themes.set(theme, [...(themes.get(theme) ?? []), item.promptRef]);
  }

  const metricValue = (key: ImplementedMetricKey) => inputs.metrics[key]?.value ?? 0;
  const repos = new Set(
    [...records.prs, ...records.reviews, ...records.commits].map((r) => r.repo.fullName),
  );
  return {
    period,
    items,
    metrics: packMetrics(inputs),
    metricValues: metricValuesFor(inputs, input.metricKeys ?? DOCUMENT_METRICS),
    counts: {
      prsMerged: metricValue('prs_merged'),
      prsReviewed: metricValue('prs_reviewed'),
      commits: metricValue('commits'),
      repos: repos.size,
      achievements: records.achievements.length,
    },
    themes: [...themes.entries()]
      .map(([theme, refs]) => ({ theme, refs }))
      .sort((a, b) => b.refs.length - a.refs.length || (a.theme < b.theme ? -1 : 1)),
    scoreStatus: inputs.status,
    redacted: aliases.size > 0,
  };
}

/** Evidence as the model sees it (no URLs, no ids; aliases for redacted repos). */
export function promptEvidence(pack: EvidencePack) {
  return {
    period: {
      label: pack.period.label,
      startDate: pack.period.startDate,
      endDate: pack.period.endDate,
    },
    metrics: pack.metrics
      .filter((m) => m.display !== null)
      .map((m) => ({ metric: m.label, value: m.display, sampleSize: m.n })),
    counts: pack.counts,
    themes: pack.themes.map((t) => ({ repository: t.theme, refs: t.refs })),
    ...(pack.score ? { impactScore: pack.score } : {}),
    items: pack.items.map((item) => ({
      ref: item.promptRef,
      kind: item.kind,
      repository: item.repoLabel,
      title: item.title,
      date: item.occurredAt.slice(0, 10),
      tags: item.tags,
      ...item.facts,
    })),
  };
}
