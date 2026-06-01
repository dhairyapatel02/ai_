'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ImpactScoreCardProps {
  score: number;
  breakdown: {
    featureDelivery: number;
    codeQuality: number;
    collaboration: number;
    leadership: number;
  };
}

export function ImpactScoreCard({ score, breakdown }: ImpactScoreCardProps) {
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Impact Score</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-6">
        <div className="relative w-28 h-28">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
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
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold">{score}</span>
          </div>
        </div>
        <div className="space-y-2 flex-1">
          <ScoreBar label="Features" value={breakdown.featureDelivery} />
          <ScoreBar label="Quality" value={breakdown.codeQuality} />
          <ScoreBar label="Collab" value={breakdown.collaboration} />
          <ScoreBar label="Leadership" value={breakdown.leadership} />
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
