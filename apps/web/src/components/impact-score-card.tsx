'use client';

import { Gauge } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

export interface ImpactDimensionView {
  key: string;
  label: string;
  score: number | null;
  available?: boolean;
}

/** `impact@2.0.0` bands (KPI_METHODOLOGY §6.5) — accent ramp only, never traffic lights. */
export const IMPACT_BANDS = [
  { label: 'Low signal', min: 0, max: 40 },
  { label: 'Moderate', min: 40, max: 60 },
  { label: 'Strong', min: 60, max: 80 },
  { label: 'Very strong', min: 80, max: 101 },
] as const;

export function bandIndex(score: number): number {
  return IMPACT_BANDS.findIndex((b) => score >= b.min && score < b.max);
}

const NOT_ENOUGH_DATA = 'Not enough activity in this period to compute a fair score';

/** What each dimension needs (re-weighting note, S6 Partial). */
const DIMENSION_NEEDS: Record<string, string> = {
  delivery: 'merged PRs',
  quality: 'merged PRs',
  collaboration: 'reviews',
  ownership: 'activity',
};

/** "Quality isn't scored yet — not enough merged PRs in this period. The other dimensions were re-weighted." */
export function reweightNote(dimensions: ImpactDimensionView[]): string | null {
  const missing = dimensions.filter((d) => d.available === false);
  if (missing.length === 0) return null;
  const names = missing.map((d) => d.label).join(' and ');
  const needs = [...new Set(missing.map((d) => DIMENSION_NEEDS[d.key] ?? 'data'))].join(' or ');
  return `${names} ${missing.length === 1 ? "isn't" : "aren't"} scored yet — not enough ${needs} in this period. The other dimensions were re-weighted.`;
}

/** 4-segment band scale with the current band filled (DESIGN_SYSTEM §6). */
export function ImpactBands({ score }: { score: number | null }) {
  const current = score === null ? -1 : bandIndex(score);
  return (
    <div aria-hidden="true">
      <div className="grid grid-cols-4 gap-1">
        {IMPACT_BANDS.map((band, i) => (
          <span
            key={band.label}
            className={cn('h-1.5 rounded-full', i === current ? 'bg-primary' : 'bg-surface-3')}
          />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1 text-caption text-subtle-foreground">
        {IMPACT_BANDS.map((band, i) => (
          <span key={band.label} className={cn('truncate', i === current && 'text-foreground')}>
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Four labelled horizontal bars 0–100 with values (one hue; labels carry identity). */
export function DimensionBars({ dimensions }: { dimensions: ImpactDimensionView[] }) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Dimensions">
      {dimensions.map((d) => (
        <li key={d.key} className="flex flex-col gap-1">
          <span className="flex justify-between text-sm">
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-medium tabular-nums">
              {d.score ?? (
                <span className="text-subtle-foreground" title="Not enough data">
                  —<span className="sr-only"> not enough data</span>
                </span>
              )}
            </span>
          </span>
          <span
            className="block h-1.5 overflow-hidden rounded-full bg-surface-3"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full bg-chart-5"
              style={{ width: `${d.score ?? 0}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Deterministic impact score `impact@2.0.0` (DESIGN_SYSTEM §5.2 ImpactScoreCard, S6): number +
 * `/ 100` + band badge, band scale, four dimension bars, the re-weighting note, "How is this
 * calculated?" (the §6.7 explanation) and the insufficient-data state with a longer-period action.
 */
export function ImpactScoreCard({
  score,
  band,
  dimensions,
  scoreVersion,
  loading = false,
  detailHref,
  periodLabel,
  explanation,
  insufficientAction,
  fetching = false,
}: {
  score: number | null;
  band?: string | null;
  dimensions: ImpactDimensionView[];
  scoreVersion?: string;
  loading?: boolean;
  detailHref?: string;
  periodLabel?: string;
  explanation?: string;
  insufficientAction?: ReactNode;
  fetching?: boolean;
}) {
  const note = score !== null ? reweightNote(dimensions) : null;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-x-2 gap-y-0">
        <CardTitle className="mr-auto flex items-baseline gap-2">
          <h2>Impact score</h2>
          {periodLabel ? (
            <span className="text-sm font-normal text-subtle-foreground">{periodLabel}</span>
          ) : null}
        </CardTitle>
        {detailHref ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={detailHref}>Details</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent
        className={cn('flex flex-col gap-4 transition-opacity', fetching && 'opacity-60')}
      >
        {loading ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">Loading impact score</span>
          </div>
        ) : (
          <>
            {score !== null ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className="text-3xl font-semibold tracking-tight"
                    data-testid="impact-score-value"
                  >
                    {score}
                  </span>
                  <span className="text-base text-subtle-foreground">/ 100</span>
                  {band ? (
                    <Badge variant="accent" className="ml-1">
                      <Gauge aria-hidden="true" />
                      {band}
                    </Badge>
                  ) : null}
                </div>
                <ImpactBands score={score} />
                <p className="text-caption text-subtle-foreground">
                  Signal from your GitHub activity — not a judgement of your performance.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
                <p className="font-medium" data-testid="impact-score-value">
                  <span className="sr-only">Impact score: </span>
                  {NOT_ENOUGH_DATA}
                </p>
                <p className="text-sm text-muted-foreground">
                  The score needs at least 3 merged or reviewed PRs and 7 days. Try a longer period.
                </p>
                {insufficientAction}
              </div>
            )}
            <DimensionBars
              dimensions={
                score === null ? dimensions.map((d) => ({ ...d, score: null })) : dimensions
              }
            />
            {note ? <p className="text-caption text-subtle-foreground">{note}</p> : null}
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer text-link underline underline-offset-2"
                  >
                    How is this calculated?
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 text-sm" align="start">
                  <p className="whitespace-pre-line text-muted-foreground">
                    {explanation ??
                      'A weighted summary of four dimensions — Delivery, Quality, Collaboration and Ownership — computed deterministically from your GitHub activity. It is signal, not a judgement of your performance.'}
                  </p>
                  {detailHref ? (
                    <Link
                      href={detailHref}
                      className="mt-2 inline-block text-link underline underline-offset-2"
                    >
                      See the inputs
                    </Link>
                  ) : null}
                </PopoverContent>
              </Popover>
              {scoreVersion ? (
                <span className="font-mono text-caption text-subtle-foreground">
                  {scoreVersion}
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
