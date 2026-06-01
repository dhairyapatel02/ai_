'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GenerateButton } from '@/components/generate-button';
import { ResumeBulletCard } from '@/components/resume-bullet-card';
import { Download, Copy } from 'lucide-react';

const roles = ['backend', 'frontend', 'fullstack', 'devops', 'manager'] as const;

export default function ResumePage() {
  const [role, setRole] = useState<string>('fullstack');
  const [dateFrom, setDateFrom] = useState('2024-01-01');
  const [dateTo, setDateTo] = useState('2024-06-30');
  const [loading, setLoading] = useState(false);
  const [bullets, setBullets] = useState<{ text: string; category: string; impact: string }[]>([]);

  const handleGenerate = async () => {
    setLoading(true);
    // Simulate generation - replace with actual API call
    setTimeout(() => {
      setBullets([
        { text: 'Engineered a real-time notification system serving 50K+ daily active users, reducing notification delivery latency by 40% through optimized WebSocket connections and Redis pub/sub architecture.', category: 'features', impact: '40% latency reduction' },
        { text: 'Led migration of legacy REST APIs to GraphQL, reducing frontend data fetching overhead by 60% and improving page load times across 12 customer-facing dashboards.', category: 'performance', impact: '60% reduction in data fetching' },
        { text: 'Implemented comprehensive CI/CD pipeline with automated testing, reducing deployment time from 45 minutes to 8 minutes while maintaining 99.9% uptime SLA.', category: 'reliability', impact: '82% faster deployments' },
        { text: 'Mentored 3 junior engineers through code reviews and pair programming sessions, contributing to team velocity increase of 25% over the quarter.', category: 'collaboration', impact: '25% team velocity increase' },
        { text: 'Designed and implemented a distributed caching layer using Redis Cluster, handling 100K+ requests/second with sub-millisecond p99 latency.', category: 'performance', impact: '100K+ req/s capacity' },
      ]);
      setLoading(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Resume Generator</h1>
        <p className="text-muted-foreground">Generate professional resume bullet points from your engineering activity</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Resume Bullets
          </GenerateButton>
        </CardContent>
      </Card>

      {bullets.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Generated Bullets</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1">
                <Copy className="h-3 w-3" />
                Copy All
              </Button>
              <Button variant="outline" size="sm" className="gap-1">
                <Download className="h-3 w-3" />
                Export PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {bullets.map((bullet, i) => (
              <ResumeBulletCard key={i} bullet={bullet} category={bullet.category} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
