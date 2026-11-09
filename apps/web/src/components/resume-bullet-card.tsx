'use client';

import { Badge } from '@/components/ui/badge';

interface ResumeBulletCardProps {
  bullet: { text: string; impact: string };
  category: string;
}

export function ResumeBulletCard({ bullet, category }: ResumeBulletCardProps) {
  const categoryColors: Record<string, string> = {
    performance: 'bg-orange-100 text-orange-800',
    reliability: 'bg-green-100 text-green-800',
    features: 'bg-blue-100 text-blue-800',
    collaboration: 'bg-purple-100 text-purple-800',
    leadership: 'bg-amber-100 text-amber-800',
  };

  return (
    <div className="p-4 border rounded-lg space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-relaxed">{bullet.text}</p>
        <Badge className={categoryColors[category] || 'bg-gray-100 text-gray-800'} variant="secondary">
          {category}
        </Badge>
      </div>
      {bullet.impact && (
        <p className="text-xs text-muted-foreground">Impact: {bullet.impact}</p>
      )}
    </div>
  );
}
