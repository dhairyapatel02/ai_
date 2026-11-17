'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMetric } from '@/lib/metrics-format';

import type { MetricValue } from '@devimpact/shared';

interface DocumentPreviewProps {
  content: Record<string, unknown>;
  type: string;
}

interface Claim {
  id?: string;
  title?: string;
  text: string;
  citations?: string[];
  flags?: string[];
}

const LABELS: Record<string, string> = {
  summary: 'Summary',
  bullets: 'Highlights',
  executiveSummary: 'Executive summary',
  keyContributions: 'Key contributions',
  metrics: 'Metrics (computed)',
  areasOfImpact: 'Areas of impact',
  growth: 'Growth',
  nextGoals: 'Next goals',
  whyReady: 'Why ready',
  leadershipEvidence: 'Leadership',
  technicalImpact: 'Technical impact',
  businessValue: 'Business value',
  mentorship: 'Mentorship',
  supportingData: 'Supporting data (computed)',
};

const isClaim = (v: unknown): v is Claim =>
  typeof v === 'object' && v !== null && typeof (v as Claim).text === 'string';
const isMetric = (v: unknown): v is MetricValue =>
  typeof v === 'object' && v !== null && 'key' in v && 'unit' in v && 'label' in v;

function ClaimView({ claim }: { claim: Claim }) {
  return (
    <li className="space-y-1">
      {claim.title && <p className="text-sm font-medium">{claim.title}</p>}
      <p className="text-sm leading-relaxed">{claim.text}</p>
      <div className="flex flex-wrap gap-1">
        {(claim.citations ?? []).map((ref) => (
          <Badge key={ref} variant="secondary" className="font-mono text-[11px]">
            {ref}
          </Badge>
        ))}
        {(claim.flags ?? []).map((flag) => (
          <Badge key={flag} className="bg-amber-100 text-amber-900" variant="secondary">
            {flag === 'uncited' ? 'No evidence linked' : 'Invalid citation removed'}
          </Badge>
        ))}
      </div>
    </li>
  );
}

function Section({ name, value }: { name: string; value: unknown }) {
  const label = LABELS[name] ?? name;
  if (Array.isArray(value) && value.every(isMetric)) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <table className="w-full text-sm">
          <tbody>
            {value.map((m) => (
              <tr key={m.key} className="border-b last:border-0">
                <td className="py-1 text-muted-foreground">{m.label}</td>
                <td className="py-1 text-right font-medium">{formatMetric(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }
  const items = (Array.isArray(value) ? value : [value]).filter(isClaim);
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <ul className="space-y-3">
        {items.map((claim, i) => (
          <ClaimView key={claim.id ?? i} claim={claim} />
        ))}
      </ul>
    </section>
  );
}

/** Interim renderer of v2 document content (P11 builds the designed viewer, S16). */
export function DocumentPreview({ content, type }: DocumentPreviewProps) {
  const body =
    typeof content.sections === 'object' && content.sections !== null
      ? (content.sections as Record<string, unknown>)
      : content;
  const legacy = content.legacy === true;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg capitalize">{type.toLowerCase()} Document</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {legacy ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {JSON.stringify(content.raw, null, 2)}
          </pre>
        ) : (
          Object.entries(body)
            .filter(([key]) => key !== 'format')
            .map(([key, value]) => <Section key={key} name={key} value={value} />)
        )}
      </CardContent>
    </Card>
  );
}
