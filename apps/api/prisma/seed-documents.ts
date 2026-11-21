import {
  periodSpecContaining,
  resolvePeriod,
  shiftPeriodSpec,
  todayIn,
  type ResolvedPeriod,
} from '@devimpact/shared';
import { DocumentType, type Prisma, type PrismaClient } from '@prisma/client';

import { prRef } from '../src/common/evidence-refs';
import { DOCUMENT_METRICS, metricValuesFor } from '../src/evidence/evidence-pack';
import { ImpactScoreService } from '../src/metrics/impact-score.service';
import { MetricsRepository } from '../src/metrics/metrics.repository';

import type { PrismaService } from '../src/prisma/prisma.service';

const DAY_MS = 86_400_000;
const MODEL = 'claude-opus-5-5';

/**
 * P11: v2 documents for the studio screens (library, viewer, versions, flags). Content is shaped
 * exactly like generated output (`CONTENT_SCHEMAS`): every claim cites the demo user's own merged
 * pull requests in the document's period, engine sections come from the real impact-score
 * service, the appraisal has three versions and one uncited claim, and the resume has a pinned
 * and a used bullet. Prose contains no numbers (numbers only come from the engine, KPI §8).
 */
export async function seedDocuments(prisma: PrismaClient, userId: string, today: Date) {
  const timezone = 'Europe/London';
  const localToday = todayIn(timezone, today);
  const scores = new ImpactScoreService(new MetricsRepository(prisma as PrismaService));
  const at = (daysAgo: number) => new Date(today.getTime() - daysAgo * DAY_MS);

  async function evidence(period: ResolvedPeriod) {
    const prs = await prisma.pullRequest.findMany({
      where: {
        userId,
        isAuthoredByUser: true,
        mergedAt: {
          gte: new Date(`${period.startDate}T00:00:00Z`),
          lt: new Date(Date.parse(`${period.endDate}T00:00:00Z`) + DAY_MS),
        },
        repository: { included: true },
        legacyStub: false,
      },
      include: { repository: true },
      orderBy: [{ additions: 'desc' }, { number: 'asc' }],
      take: 40,
    });
    const items = prs.map((pr) => ({
      ref: prRef(pr.repository.fullName, pr.number),
      title: pr.title,
    }));
    const { inputs } = await scores.scoreFor(userId, period);
    return { items, metrics: metricValuesFor(inputs, DOCUMENT_METRICS) };
  }

  const pick = (items: { ref: string; title: string }[], i: number) =>
    items[i % Math.max(1, items.length)] ?? {
      ref: 'PR-acme/payments-api#1',
      title: 'Payments work',
    };
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

  async function create(
    type: DocumentType,
    title: string,
    options: Prisma.InputJsonValue,
    period: ResolvedPeriod,
    refs: string[],
    versions: { source: 'AI' | 'USER_EDIT' | 'RESTORE'; content: unknown; daysAgo: number }[],
    flags: { uncited: number; coverage: number },
  ) {
    const last = versions[versions.length - 1];
    return prisma.generatedDocument.create({
      data: {
        userId,
        type,
        title,
        status: 'READY',
        currentVersion: versions.length,
        options,
        periodStart: new Date(`${period.startDate}T00:00:00Z`),
        periodEnd: new Date(`${period.endDate}T00:00:00Z`),
        timezone,
        promptId: type.toLowerCase(),
        promptVersion: 1,
        model: MODEL,
        inputHash: `seed:${type}:${period.spec}`,
        evidenceRefs: refs,
        citationCoverage: flags.coverage,
        flagsUncited: flags.uncited,
        flagsInvalid: 0,
        createdAt: at(versions[0]?.daysAgo ?? 0),
        updatedAt: at(last?.daysAgo ?? 0),
        versions: {
          create: versions.map((v, i) => ({
            version: i + 1,
            source: v.source,
            content: v.content as Prisma.InputJsonValue,
            createdAt: at(v.daysAgo),
          })),
        },
      },
    });
  }

  // Appraisal for the previous half: v1 generated, v2 edited, v3 regenerated (one uncited claim).
  const halfSpec = shiftPeriodSpec(periodSpecContaining('half', localToday), -1);
  const half = resolvePeriod(halfSpec, timezone, localToday);
  const a = await evidence(half);
  const appraisal = (summary: string) => ({
    sections: {
      executiveSummary: {
        id: 'es1',
        text: summary,
        citations: [pick(a.items, 0).ref, pick(a.items, 1).ref],
      },
      keyContributions: [0, 1, 2, 3].map((i) => ({
        id: `kc${i + 1}`,
        title: pick(a.items, i).title,
        text:
          [
            'Kept it small and easy to review, with tests for the failure paths.',
            'Found and fixed the root cause instead of patching the symptom.',
            'Rolled it out behind a feature flag and watched the error rate.',
            'Paired with the reviewers early, so it merged in one round.',
          ][i] ?? 'Delivered as a small, well-reviewed change set.',
        citations: [pick(a.items, i).ref],
      })),
      metrics: a.metrics,
      areasOfImpact: [
        {
          id: 'ai1',
          text: 'Reliability of the payment flows, from intent creation to webhooks.',
          citations: [pick(a.items, 4).ref],
        },
        {
          id: 'ai2',
          text: 'Developer experience through faster reviews and smaller pull requests.',
          citations: [pick(a.items, 5).ref],
        },
      ],
      growth: [
        {
          id: 'gr1',
          text: 'Took on larger cross-repository changes and staged them behind feature flags.',
          citations: [pick(a.items, 6).ref],
        },
        {
          id: 'gr2',
          text: 'Regularly unblocked the platform team during on-call handovers.',
          citations: [],
          flags: ['uncited'],
        },
      ],
      nextGoals: [
        { id: 'ng1', text: 'Lead a cross-team design review next half.' },
        { id: 'ng2', text: 'Keep review turnaround under one working day.' },
      ],
    },
  });
  await create(
    DocumentType.APPRAISAL,
    `Appraisal · ${half.label}`,
    { type: 'appraisal', period: halfSpec },
    half,
    a.items.map((i) => i.ref),
    [
      {
        source: 'AI',
        daysAgo: 9,
        content: appraisal('In this half I focused on the reliability of our payment flows.'),
      },
      {
        source: 'USER_EDIT',
        daysAgo: 8,
        content: appraisal(
          'In this half I focused on the reliability of our payment flows and on faster reviews.',
        ),
      },
      {
        source: 'AI',
        daysAgo: 6,
        content: appraisal(
          'This half I focused on payment reliability and became a go-to reviewer for API changes.',
        ),
      },
    ],
    { uncited: 1, coverage: 0.92 },
  );

  // Resume bullets for the last 12 months (one pinned, one used).
  const yearSpec = `custom:${new Date(Date.parse(`${localToday}T00:00:00Z`) - 364 * DAY_MS)
    .toISOString()
    .slice(0, 10)}..${localToday}`;
  const year = resolvePeriod(yearSpec, timezone, localToday);
  const r = await evidence(year);
  const themes = ['Reliability', 'Delivery', 'Performance', 'Delivery', 'Quality', 'Collaboration'];
  const verbs = ['Hardened', 'Shipped', 'Sped up', 'Delivered', 'Improved', 'Reviewed and landed'];
  await create(
    DocumentType.RESUME,
    `Resume · backend · ${year.label}`,
    { type: 'resume', period: yearSpec, role: 'backend', format: 'bullets', length: 'standard' },
    year,
    r.items.map((i) => i.ref),
    [
      {
        source: 'USER_EDIT',
        daysAgo: 3,
        content: {
          format: 'bullets',
          summary: {
            id: 's1',
            text: 'Backend engineer focused on payment reliability and fast, careful reviews.',
            citations: [pick(r.items, 0).ref],
          },
          bullets: themes.map((theme, i) => ({
            id: `b${i + 1}`,
            text: `${verbs[i] ?? 'Shipped'} ${lower(pick(r.items, i).title)} in a high-volume payments platform.`,
            citations: [pick(r.items, i).ref],
            theme,
            ...(i === 0 ? { pinned: true } : {}),
            ...(i === 2 ? { used: true } : {}),
          })),
        },
      },
    ],
    { uncited: 0, coverage: 1 },
  );

  // Promotion packet (same 12 months).
  const claims = (offset: number, texts: string[]) =>
    texts.map((text, i) => ({
      id: `c${offset + i + 1}`,
      text,
      citations: [pick(r.items, offset + i).ref],
    }));
  await create(
    DocumentType.PROMOTION,
    'Promotion packet · Senior engineer → Staff engineer',
    {
      type: 'promotion',
      period: yearSpec,
      currentRole: 'Senior engineer',
      targetRole: 'Staff engineer',
    },
    year,
    r.items.map((i) => i.ref),
    [
      {
        source: 'AI',
        daysAgo: 2,
        content: {
          sections: {
            whyReady: {
              id: 'wr1',
              text: 'I already operate at staff scope: I own delivery across repositories and set the review bar for payment changes.',
              citations: [pick(r.items, 0).ref],
            },
            leadershipEvidence: claims(1, [
              'Led the checkout rollout across two teams behind a feature flag.',
              'Drove the design of idempotent webhook processing.',
            ]),
            technicalImpact: claims(3, [
              'Made payment intent creation safe to retry end to end.',
              'Split infrastructure state so staging changes never touch production.',
            ]),
            businessValue: claims(5, [
              'Removed the main driver of refund-related support tickets.',
            ]),
            mentorship: claims(6, [
              'Reviewed teammates’ pull requests with a focus on API design.',
            ]),
            supportingData: r.metrics,
          },
        },
      },
    ],
    { uncited: 0, coverage: 1 },
  );
  return 3;
}
