'use client';

import { resumeBulletSchema, type ResumeBulletOutput } from '@devimpact/shared';
import { Download, Copy } from 'lucide-react';
import { useState } from 'react';

import { GenerateButton } from '@/components/generate-button';
import { ResumeBulletCard } from '@/components/resume-bullet-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';

const roles = ['backend', 'frontend', 'fullstack', 'devops', 'manager'] as const;

type ResumeBullet = ResumeBulletOutput;

export default function ResumePage() {
  const { apiFetch } = useAuth();
  const [role, setRole] = useState<string>('fullstack');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [bullets, setBullets] = useState<ResumeBullet[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    const res = await apiFetch<{ bullets: unknown }>('/generate/resume', {
      method: 'POST',
      body: JSON.stringify({ dateRange: { from: dateFrom, to: dateTo }, role }),
    });

    // BUG-14: the API returns `bullets` as an array; validate it against the shared contract.
    const parsed = resumeBulletSchema.array().safeParse(res.data?.bullets);
    if (res.success && parsed.success) {
      setBullets(parsed.data);
    } else {
      setError(res.error || 'Generation failed. Is the ANTHROPIC_API_KEY configured?');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Resume Generator</h1>
        <p className="text-muted-foreground">
          Generate professional resume bullet points from your engineering activity
        </p>
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
                onChange={(e) => {
                  setDateFrom(e.target.value);
                }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Resume Bullets
          </GenerateButton>
          {error && <p className="text-sm text-red-500">{error}</p>}
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
