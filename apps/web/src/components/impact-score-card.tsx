import { Gauge } from 'lucide-react';
import Link from 'next/link';

import { InfoPopover } from '@/components/states/info-popover';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface ImpactDimensionView {
  key: string;
  label: string;
  score: number | null;
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

const NOT_ENOUGH_DATA =
  'Not enough activity in this period to compute a fair score — try a longer period.';

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
    <ul className="flex flex-col gap-2.5" aria-label="Dimension scores">
      {dimensions.map((d) => (
        <li key={d.key} className="flex flex-col gap-1">
          <span className="flex justify-between text-sm">
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-medium tabular-nums">{d.score ?? '—'}</span>
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
 * Deterministic impact score `impact@2.0.0` (DESIGN_SYSTEM §5.2 ImpactScoreCard): number + `/ 100`
 * + band badge, band scale, four dimension bars; insufficient-data and loading states.
 */
export function ImpactScoreCard({
  score,
  band,
  dimensions,
  scoreVersion,
  loading = false,
  detailHref,
}: {
  score: number | null;
  band?: string | null;
  dimensions: ImpactDimensionView[];
  scoreVersion?: string;
  loading?: boolean;
  detailHref?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="flex-1">
          <h2>Impact score</h2>
        </CardTitle>
        <InfoPopover label="How is the impact score calculated?" title="Impact score">
          A weighted summary of four dimensions — Delivery, Quality, Collaboration and Ownership —
          computed deterministically from your GitHub activity. It is signal, not a judgement of
          your performance.
        </InfoPopover>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">Loading impact score</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className="text-3xl font-semibold tracking-tight"
                data-testid="impact-score-value"
              >
                {score ?? '—'}
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
            {score === null ? <p className="text-muted-foreground">{NOT_ENOUGH_DATA}</p> : null}
            <DimensionBars dimensions={dimensions} />
            <p className="text-caption text-subtle-foreground">
              Signal from your GitHub activity — not a judgement of your performance.
              {scoreVersion ? <span className="font-mono"> {scoreVersion}</span> : null}
              {detailHref ? (
                <>
                  {' '}
                  <Link href={detailHref} className="text-link underline underline-offset-2">
                    See details
                  </Link>
                </>
              ) : null}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
