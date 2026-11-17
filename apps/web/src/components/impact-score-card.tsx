'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface ImpactDimensionView {
  key: string;
  label: string;
  score: number | null;
}

interface ImpactScoreCardProps {
  /** Rounded 0–100 overall score, or null when there is not enough data. */
  score: number | null;
  band?: string | null;
  dimensions: ImpactDimensionView[];
  scoreVersion?: string;
}

const NOT_ENOUGH_DATA =
  'Not enough activity in this period to compute a fair score — try a longer period.';

/**
 * Deterministic impact score `impact@2.0.0` (KPI_METHODOLOGY §6): overall + Delivery, Quality,
 * Collaboration, Ownership. Minimal P07 version; the designed ImpactScoreCard arrives in P10.
 */
export function ImpactScoreCard({ score, band, dimensions, scoreVersion }: ImpactScoreCardProps) {
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - ((score ?? 0) / 100) * circumference;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Impact Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-6">
          <div className="relative h-28 w-28 shrink-0">
            <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="hsl(var(--secondary))"
                strokeWidth="8"
              />
              {score !== null && (
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{score ?? '—'}</span>
              {band && <span className="text-xs text-muted-foreground">{band}</span>}
            </div>
          </div>
          <div className="flex-1 space-y-2">
            {dimensions.map((d) => (
              <ScoreBar key={d.key} label={d.label} value={d.score} />
            ))}
          </div>
        </div>
        {score === null && <p className="text-sm text-muted-foreground">{NOT_ENOUGH_DATA}</p>}
        <p className="text-xs text-muted-foreground">
          A summary of signals from your GitHub activity, not a judgement of your performance.
          {scoreVersion ? ` ${scoreVersion}.` : ''}
        </p>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value ?? '—'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
    </div>
  );
}
