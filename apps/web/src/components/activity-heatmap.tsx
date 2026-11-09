'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HeatmapData {
  date: string;
  count: number;
}

interface ActivityHeatmapProps {
  data: HeatmapData[];
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const getColor = (count: number) => {
    if (count === 0) return 'bg-secondary';
    const intensity = count / maxCount;
    if (intensity > 0.75) return 'bg-primary';
    if (intensity > 0.5) return 'bg-primary/75';
    if (intensity > 0.25) return 'bg-primary/50';
    return 'bg-primary/25';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Activity Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1">
          {data.map((day) => (
            <div
              key={day.date}
              className={`h-3 w-3 rounded-sm ${getColor(day.count)}`}
              title={`${day.date}: ${day.count} contributions`}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
