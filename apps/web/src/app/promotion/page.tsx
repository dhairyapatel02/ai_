'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GenerateButton } from '@/components/generate-button';
import { DocumentPreview } from '@/components/document-preview';

export default function PromotionPage() {
  const [currentRole, setCurrentRole] = useState('Senior Engineer');
  const [targetRole, setTargetRole] = useState('Staff Engineer');
  const [loading, setLoading] = useState(false);
  const [packet, setPacket] = useState<Record<string, unknown> | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setTimeout(() => {
      setPacket({
        whyReady: 'This engineer has consistently demonstrated Staff-level impact through technical leadership, cross-team influence, and significant business value creation over the past 6 months. Their work spans multiple systems and teams, showing the breadth and depth expected at the Staff level.',
        leadershipEvidence: [
          'Led architecture review for 3 major system redesigns',
          'Mentored 3 junior engineers, all promoted within 6 months',
          'Drove adoption of new testing practices across 4 teams',
        ],
        technicalImpact: [
          'Reduced system latency by 40% through caching architecture redesign',
          'Shipped 3 major features end-to-end with zero production incidents',
          'Established company-wide API design standards adopted by 8 teams',
        ],
        businessValue: [
          'Notification system directly attributed to 15% increase in user engagement',
          'Performance improvements reduced infrastructure costs by $50K/quarter',
        ],
        mentorship: [
          '45 code reviews completed with detailed, educational feedback',
          'Weekly office hours for junior engineers',
          'Created internal documentation reducing onboarding time by 40%',
        ],
      });
      setLoading(false);
    }, 2500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Promotion Packet</h1>
        <p className="text-muted-foreground">Build a data-driven promotion case from your engineering contributions</p>
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
                onChange={(e) => setCurrentRole(e.target.value)}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
                placeholder="e.g., Senior Engineer"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Role</label>
              <input
                type="text"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
                placeholder="e.g., Staff Engineer"
              />
            </div>
          </div>
          <GenerateButton loading={loading} onClick={handleGenerate}>
            Generate Promotion Packet
          </GenerateButton>
        </CardContent>
      </Card>

      {packet && <DocumentPreview content={packet} type="PROMOTION" />}
    </div>
  );
}
