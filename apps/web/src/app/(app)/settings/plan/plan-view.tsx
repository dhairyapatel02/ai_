'use client';

import { type Entitlements, type UsageResponse } from '@devimpact/shared';

import { QuotaMeter } from '@/components/quota-meter';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useEntitlements } from '@/lib/api/career-hooks';
import { useUsage } from '@/lib/api/document-hooks';
import { resetDate } from '@/lib/documents';
import { plural } from '@/lib/format';

const UPGRADE_EMAIL = 'upgrade@devimpact.dev';
const FEATURE_LABEL: Record<string, string> = {
  resume: 'Resume bullets',
  appraisal: 'Appraisals',
  promotion: 'Promotion packets',
  impact_narrative: 'Impact highlights',
  achievement_statement: 'Achievement statements',
  digest_summary: 'Digest summaries',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "3 generations left — resets December 1" once ≥ 80 % is used (S23 Partial). */
export function nearLimitNote(
  used: number,
  limit: number,
  what: string,
  resetsAt: string,
): string | undefined {
  if (limit <= 0 || used / limit < 0.8) return undefined;
  const left = Math.max(0, limit - used);
  return left === 0
    ? `You've used all ${limit} ${what} for ${MONTHS[(new Date(resetsAt).getUTCMonth() + 11) % 12] ?? ''}. They reset on ${resetDate(resetsAt)}.`
    : `${plural(left, what.replace(/s$/, ''))} left — resets ${resetDate(resetsAt)}`;
}

/**
 * Settings → Plan & usage (S23, F-06/F-07): this month's AI usage meters (`GET /me/usage`, UTC
 * month), the plans table from `GET /me/entitlements` + PRD §6 and "Email upgrade@… to move to
 * Pro" (no billing in v2.0, D-014). Tokens and estimated cost are in a collapsed section.
 */
export function PlanView() {
  const ent = useEntitlements();
  const usage = useUsage();
  const plan = ent.data?.plan;
  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="Plan & usage"
        lede={
          plan
            ? `You are on the ${plan === 'free' ? 'Free' : 'Pro'} plan.`
            : 'Your plan and AI usage this month.'
        }
      />
      {ent.isPending || usage.isPending ? (
        <PageSkeleton kind="form" label="Loading your plan and usage…" />
      ) : ent.isError || usage.isError ? (
        <div className="rounded-md border bg-card">
          <ErrorState
            error={ent.error ?? usage.error}
            what="your plan and usage"
            onRetry={() => {
              void ent.refetch();
              void usage.refetch();
            }}
          />
        </div>
      ) : (
        <PlanContent entitlements={ent.data} usage={usage.data} />
      )}
    </div>
  );
}

function PlanContent({
  entitlements,
  usage,
}: {
  entitlements: Entitlements;
  usage: UsageResponse;
}) {
  const resets = usage.generations.resetsAt;
  const monthName = MONTHS[(new Date(resets).getUTCMonth() + 11) % 12] ?? 'This month';
  const current = entitlements.plan === 'free' ? 'free' : 'pro';
  const rows: [string, string, string][] = [
    ['History window', '12 months', '36 months'],
    ['AI generations / month', '15', '150'],
    ['Quick AI actions / month', '100', '1,000'],
    ['GitHub integrations', '1', '1'],
    ['Exports and weekly digest', 'Unlimited', 'Unlimited'],
  ];
  return (
    <div className="flex flex-col gap-4">
      <section
        className="flex flex-col gap-5 rounded-md border bg-card p-4 sm:p-5"
        aria-labelledby="usage-h"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="usage-h" className="font-semibold">
            {monthName} usage
          </h2>
          <span className="text-caption text-subtle-foreground">
            Resets {resetDate(resets)} (UTC)
          </span>
        </div>
        <QuotaMeter
          label="AI document generations"
          used={usage.generations.used}
          limit={usage.generations.limit}
          note={
            nearLimitNote(usage.generations.used, usage.generations.limit, 'generations', resets) ??
            'Appraisals, promotion packets, resume bullets and regenerations. Reused results are free.'
          }
        />
        <QuotaMeter
          label="Quick AI actions"
          used={usage.quick.used}
          limit={usage.quick.limit}
          note={
            nearLimitNote(usage.quick.used, usage.quick.limit, 'quick actions', resets) ??
            'Achievement statements, impact highlights and digest summaries.'
          }
        />
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 self-start">
              Tokens and estimated cost
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-subtle-foreground">Input tokens</dt>
              <dd className="tabular-nums">{usage.tokens.input.toLocaleString('en-US')}</dd>
              <dt className="text-subtle-foreground">Output tokens</dt>
              <dd className="tabular-nums">{usage.tokens.output.toLocaleString('en-US')}</dd>
              <dt className="text-subtle-foreground">Cached input</dt>
              <dd className="tabular-nums">{usage.tokens.cacheRead.toLocaleString('en-US')}</dd>
              <dt className="text-subtle-foreground">Estimated cost</dt>
              <dd className="tabular-nums">US${usage.estimatedCostUsd.toFixed(2)}</dd>
            </dl>
            {usage.byFeature.length ? (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {usage.byFeature.map((f) => (
                  <li key={f.feature} className="flex justify-between gap-3">
                    <span>{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {plural(f.count, 'run')} · {f.tokens.toLocaleString('en-US')} tokens
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </section>

      <section className="rounded-md border bg-card" aria-labelledby="plans-h">
        <h2 id="plans-h" className="px-4 pt-4 font-semibold sm:px-5">
          Plans
        </h2>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Free and Pro plan limits</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  <span className="sr-only">Limit</span>
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Free {current === 'free' ? <Badge variant="accent">Current</Badge> : null}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Pro {current === 'pro' ? <Badge variant="accent">Current</Badge> : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, free, pro]) => (
                <tr key={k} className="border-b last:border-b-0">
                  <th
                    scope="row"
                    className="px-4 py-2 text-left font-normal text-muted-foreground sm:px-5"
                  >
                    {k}
                  </th>
                  <td className="px-4 py-2 tabular-nums">{free}</td>
                  <td className="px-4 py-2 tabular-nums">{pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-3 text-sm sm:px-5">
          Need more? Email <span className="font-mono select-all">{UPGRADE_EMAIL}</span> and
          we&apos;ll move you to Pro.
        </p>
      </section>
    </div>
  );
}
