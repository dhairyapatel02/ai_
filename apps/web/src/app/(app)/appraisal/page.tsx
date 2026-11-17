'use client';

import { useState } from 'react';

import { DocumentPreview } from '@/components/document-preview';
import { GenerateButton } from '@/components/generate-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGenerateDocument } from '@/lib/documents';

type PeriodType = 'month' | 'quarter' | 'half' | 'year';

function periodSpec(type: PeriodType, year: number, month: number): string {
  switch (type) {
    case 'month':
      return `month:${year}-${String(month).padStart(2, '0')}`;
    case 'quarter':
      return `quarter:${year}-Q${Math.ceil(month / 3)}`;
    case 'half':
      return `half:${year}-H${month <= 6 ? 1 : 2}`;
    case 'year':
      return `year:${year}`;
  }
}

/** Interim appraisal page on `POST /documents` (P08); the designed studio is P11 (S14). */
export default function AppraisalPage() {
  const { generate, loading, error, detail } = useGenerateDocument();
  const [type, setType] = useState<PeriodType>('quarter');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const handleGenerate = () =>
    generate({ type: 'appraisal', period: periodSpec(type, year, month) });

  const select = 'w-full rounded-md border border-input px-3 py-2 text-sm';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Appraisal Report</h1>
        <p className="text-muted-foreground">
          Performance appraisal from your activity; the metrics table is computed, not written by AI
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-sm font-medium">
              Period
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as PeriodType);
                }}
                className={select}
              >
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="half">Half year</option>
                <option value="year">Year</option>
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              Containing month
              <select
                value={month}
                onChange={(e) => {
                  setMonth(parseInt(e.target.value));
                }}
                className={select}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2024, i).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              Year
              <input
                type="number"
                value={year}
                onChange={(e) => {
                  setYear(parseInt(e.target.value));
                }}
                min={2020}
                max={2030}
                className={select}
              />
            </label>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Appraisal
          </GenerateButton>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {detail?.version && (
        <DocumentPreview
          content={detail.version.content as Record<string, unknown>}
          type="APPRAISAL"
        />
      )}
    </div>
  );
}
