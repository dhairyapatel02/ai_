'use client';

import { useState } from 'react';

import { DocumentPreview } from '@/components/document-preview';
import { GenerateButton } from '@/components/generate-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGenerateDocument } from '@/lib/documents';

/** Interim promotion page on `POST /documents` (last 12 months); the studio is P11 (S15). */
export default function PromotionPage() {
  const { generate, loading, error, detail } = useGenerateDocument();
  const [currentRole, setCurrentRole] = useState('Senior Engineer');
  const [targetRole, setTargetRole] = useState('Staff Engineer');

  const handleGenerate = () => generate({ type: 'promotion', currentRole, targetRole });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Promotion Packet</h1>
        <p className="text-muted-foreground">
          Build a data-driven promotion case from your engineering contributions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Current Role</label>
              <input
                type="text"
                value={currentRole}
                onChange={(e) => {
                  setCurrentRole(e.target.value);
                }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
                placeholder="e.g., Senior Engineer"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Role</label>
              <input
                type="text"
                value={targetRole}
                onChange={(e) => {
                  setTargetRole(e.target.value);
                }}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
                placeholder="e.g., Staff Engineer"
              />
            </div>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Promotion Packet
          </GenerateButton>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      {detail?.version && (
        <DocumentPreview
          content={detail.version.content as Record<string, unknown>}
          type="PROMOTION"
        />
      )}
    </div>
  );
}
