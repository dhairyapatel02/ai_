'use client';

import { useState } from 'react';

import { DocumentPreview } from '@/components/document-preview';
import { GenerateButton } from '@/components/generate-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGenerateDocument } from '@/lib/documents';

const roles = ['backend', 'frontend', 'fullstack', 'devops', 'manager'] as const;

/** Interim resume page on `POST /documents` (P08); the designed studio is P11 (S13). */
export default function ResumePage() {
  const { generate, loading, error, detail } = useGenerateDocument();
  const [role, setRole] = useState<string>('fullstack');
  const [format, setFormat] = useState<'bullets' | 'narrative'>('bullets');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const handleGenerate = () =>
    generate({ type: 'resume', period: `custom:${dateFrom}..${dateTo}`, role, format });

  const select = 'w-full rounded-md border border-input px-3 py-2 text-sm';
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Resume Generator</h1>
        <p className="text-muted-foreground">
          Resume bullets from your engineering activity, every claim linked to evidence
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2 text-sm font-medium">
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                }}
                className={select}
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              To
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                }}
                className={select}
              />
            </label>
            <label className="space-y-2 text-sm font-medium">
              Role
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                }}
                className={select}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              Format
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as 'bullets' | 'narrative');
                }}
                className={select}
              >
                <option value="bullets">Bullets</option>
                <option value="narrative">Narrative</option>
              </select>
            </label>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Resume
          </GenerateButton>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {detail?.version && (
        <DocumentPreview
          content={detail.version.content as Record<string, unknown>}
          type="RESUME"
        />
      )}
    </div>
  );
}
