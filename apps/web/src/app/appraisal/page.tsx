'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GenerateButton } from '@/components/generate-button';
import { DocumentPreview } from '@/components/document-preview';
import { useAuth } from '@/lib/auth-context';
import { Download } from 'lucide-react';

export default function AppraisalPage() {
  const { apiFetch } = useAuth();
  const [period, setPeriod] = useState('quarterly');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    const res = await apiFetch<{ report: Record<string, unknown> }>('/generate/appraisal', {
      method: 'POST',
      body: JSON.stringify({ period, month, year }),
    });

    if (res.success && res.data?.report) {
      setReport(res.data.report);
    } else {
      setError(res.error || 'Generation failed. Is the ANTHROPIC_API_KEY configured?');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Appraisal Report</h1>
        <p className="text-muted-foreground">
          Generate performance appraisal documents from your activity data
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2024, i).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                min={2020}
                max={2030}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
              />
            </div>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Appraisal
          </GenerateButton>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {report && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Export Document
            </Button>
          </div>
          <DocumentPreview content={report} type="APPRAISAL" />
        </div>
      )}
    </div>
  );
}
