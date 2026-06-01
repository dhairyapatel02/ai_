'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GenerateButton } from '@/components/generate-button';
import { DocumentPreview } from '@/components/document-preview';
import { Download } from 'lucide-react';

export default function AppraisalPage() {
  const [period, setPeriod] = useState('quarterly');
  const [month, setMonth] = useState(6);
  const [year, setYear] = useState(2024);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setTimeout(() => {
      setReport({
        executiveSummary: 'Demonstrated exceptional technical leadership and delivery consistency during Q2 2024. Key achievements include the successful launch of 3 major features, significant performance improvements, and active mentorship of junior team members.',
        keyContributions: [
          { title: 'Real-time Notification System', evidence: 'Designed and shipped WebSocket-based notification system serving 50K+ users' },
          { title: 'GraphQL Migration', evidence: 'Led REST-to-GraphQL migration across 12 dashboards, reducing data fetching by 60%' },
          { title: 'CI/CD Pipeline Optimization', evidence: 'Reduced deployment time from 45min to 8min while maintaining 99.9% uptime' },
        ],
        metrics: { prCount: 28, reviewCount: 45, featuresShipped: 3, commitsCount: 142 },
        areasOfImpact: ['Backend infrastructure and scalability', 'Developer experience and tooling', 'Team productivity and mentorship'],
        growthAndLearning: ['Deepened expertise in distributed systems', 'Developed leadership skills through mentoring 3 engineers'],
        goalsForNextPeriod: ['Lead architecture of new microservices platform', 'Achieve Staff Engineer competencies', 'Publish internal technical blog posts'],
      });
      setLoading(false);
    }, 2500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Appraisal Report</h1>
        <p className="text-muted-foreground">Generate performance appraisal documents from your activity data</p>
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
