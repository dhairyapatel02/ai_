'use client';

import { CircleAlert, FileText, Gauge, ListChecks, Plug } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { plural } from '@/lib/format';
import { dismissRule, type NextStep, type NextStepRule } from '@/lib/next-step';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface CardCopy {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  why: string;
  action: ReactNode;
}

/**
 * NextStepCard (DESIGN_SYSTEM §5.2, S6): one recommendation with the reason it is shown, a
 * primary action and "Not now" (hides that rule for 7 days on this device).
 */
export function NextStepCard({
  step,
  halfCounts,
  reconnect,
  reconnecting,
  suspendedOrg,
  onDismiss,
}: {
  step: NextStep;
  /** Merged / reviewed since the appraisal period began (rule 3). */
  halfCounts: { merged: number; reviewed: number } | null;
  reconnect: () => void;
  reconnecting: boolean;
  suspendedOrg: string | null;
  onDismiss: (rule: NextStepRule) => void;
}) {
  const copy = (() => {
    switch (step.rule) {
      case 'reconnect':
        return {
          icon: Plug,
          title: suspendedOrg ? `Ask ${suspendedOrg} to unsuspend DevImpact` : 'Reconnect GitHub',
          body: suspendedOrg
            ? `New work in ${suspendedOrg} repositories isn't imported. Your personal repositories keep syncing.`
            : "New work isn't being imported until you reconnect. Nothing has been deleted.",
          why: suspendedOrg
            ? `Shown because ${suspendedOrg} suspended the GitHub App.`
            : 'Shown because GitHub access was revoked.',
          action: suspendedOrg ? (
            <Button size="sm" asChild>
              <Link href="/settings/integrations">View details</Link>
            </Button>
          ) : (
            <Button size="sm" loading={reconnecting} onClick={reconnect}>
              Reconnect
            </Button>
          ),
        };
      case 'sync_failed':
        return {
          icon: CircleAlert,
          title: 'Review the failed sync',
          body: 'GitHub returned an error during the last sync. The data shown is from the last successful sync.',
          why: 'Shown because the last sync failed.',
          action: (
            <Button size="sm" asChild>
              <Link href="/settings/integrations">View details</Link>
            </Button>
          ),
        };
      case 'appraisal': {
        const label = step.periodLabel ?? 'this half';
        const short = label.split(' ')[0] ?? label;
        return {
          icon: FileText,
          title: `Start your ${label} appraisal`,
          body: `${
            halfCounts
              ? `Since ${short} began you've merged ${plural(halfCounts.merged, 'PR')} and reviewed ${formatPlain(halfCounts.reviewed)}. `
              : ''
          }${short} ends in ${plural(step.daysLeft ?? 0, 'day')} — draft now with the evidence so far and refine it later.`,
          why: `Shown because ${short} ends in ${plural(step.daysLeft ?? 0, 'day')} and you have no ${label} appraisal yet.`,
          action: (
            <Button size="sm" asChild>
              <Link
                href={`/documents/new/appraisal?period=${encodeURIComponent(step.periodSpec ?? '')}`}
              >
                Draft appraisal
              </Link>
            </Button>
          ),
        };
      }
      case 'resume':
        return {
          icon: ListChecks,
          title: 'Refresh your resume bullets',
          body: 'Your newest resume bullets are more than 90 days old. Regenerate them from recent work.',
          why: 'Shown because your newest resume is older than 90 days.',
          action: (
            <Button size="sm" asChild>
              <Link href="/documents/new/resume">Generate resume bullets</Link>
            </Button>
          ),
        };
      case 'impact':
        return {
          icon: Gauge,
          title: 'See what drove your impact score',
          body: 'Each dimension lists the metrics, sample sizes and weights behind it.',
          why: 'Shown because nothing needs your attention right now.',
          action: (
            <Button size="sm" asChild>
              <Link href="/kpis/impact">Open impact score</Link>
            </Button>
          ),
        };
    }
  })() satisfies CardCopy;

  const Icon = copy.icon;
  return (
    <Card data-testid="next-step">
      <CardHeader>
        <CardTitle>
          <h2>Next step</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <b className="font-semibold">{copy.title}</b>
            <span className="text-sm text-muted-foreground">{copy.body}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {copy.action}
          {step.rule !== 'impact' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                dismissRule(step.rule);
                onDismiss(step.rule);
              }}
            >
              Not now
            </Button>
          ) : null}
        </div>
        <span className="text-caption text-subtle-foreground">{copy.why}</span>
      </CardContent>
    </Card>
  );
}

function formatPlain(n: number) {
  return n.toLocaleString('en-US');
}
