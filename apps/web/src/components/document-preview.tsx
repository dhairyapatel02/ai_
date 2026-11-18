import { Calculator, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMetric } from '@/lib/metrics-format';

import { EvidenceChip } from './evidence-chip';

import type { MetricValue } from '@devimpact/shared';

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
  metrics: 'Metrics',
  areasOfImpact: 'Areas of impact',
  growth: 'Growth',
  nextGoals: 'Next goals',
  whyReady: 'Why ready',
  leadershipEvidence: 'Leadership',
  technicalImpact: 'Technical impact',
  businessValue: 'Business value',
  mentorship: 'Mentorship',
  supportingData: 'Supporting data',
};

const TYPE_TITLES: Record<string, string> = {
  resume: 'Resume',
  appraisal: 'Appraisal',
  promotion: 'Promotion packet',
};

const isClaim = (v: unknown): v is Claim =>
  typeof v === 'object' && v !== null && typeof (v as Claim).text === 'string';
const isMetric = (v: unknown): v is MetricValue =>
  typeof v === 'object' && v !== null && 'key' in v && 'unit' in v && 'label' in v;

function ClaimView({ claim }: { claim: Claim }) {
  const flags = claim.flags ?? [];
  return (
    <li className="flex flex-col gap-1.5">
      {claim.title ? <p className="font-medium">{claim.title}</p> : null}
      <p className="text-md leading-relaxed">{claim.text}</p>
      {(claim.citations?.length ?? 0) > 0 || flags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {(claim.citations ?? []).map((ref) => (
            <EvidenceChip key={ref} refId={ref} />
          ))}
          {flags.map((flag) => (
            <Badge key={flag} variant="warning">
              <TriangleAlert aria-hidden="true" />
              {flag === 'uncited' ? 'No evidence linked' : 'Invalid citation removed'}
            </Badge>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Section({ name, value }: { name: string; value: unknown }) {
  const label = LABELS[name] ?? name;
  if (Array.isArray(value) && value.length > 0 && value.every(isMetric)) {
    return (
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold">{label}</h3>
          <Badge variant="neutral">
            <Calculator aria-hidden="true" />
            Calculated by DevImpact — not written by AI
          </Badge>
        </div>
        <table className="w-full text-sm">
          <caption className="sr-only">{label}</caption>
          <tbody>
            {value.map((m) => (
              <tr key={m.key} className="border-b last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
                  {m.label}
                </th>
                <td className="py-1.5 text-right font-medium tabular-nums">{formatMetric(m)}</td>
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
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-semibold">{label}</h3>
      <ul className="flex flex-col gap-4">
        {items.map((claim, i) => (
          <ClaimView key={claim.id ?? i} claim={claim} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Interim renderer of v2 document content (placeholder for P11's DocumentRenderer, S16): section
 * headings, claims with evidence chips and flags, engine tables labelled as calculated.
 */
export function DocumentPreview({
  content,
  type,
}: {
  content: Record<string, unknown>;
  type: string;
}) {
  const body =
    typeof content.sections === 'object' && content.sections !== null
      ? (content.sections as Record<string, unknown>)
      : content;
  const legacy = content.legacy === true;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{TYPE_TITLES[type.toLowerCase()] ?? 'Document'}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex max-w-(--reading-max) flex-col gap-6">
        {legacy ? (
          <>
            <p className="text-muted-foreground">
              Imported from DevImpact v0.1. This version is read-only.
            </p>
            <pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-4 font-mono text-sm whitespace-pre-wrap">
              {typeof content.raw === 'string' ? content.raw : JSON.stringify(content.raw, null, 2)}
            </pre>
          </>
        ) : (
          Object.entries(body)
            .filter(([key]) => key !== 'format')
            .map(([key, value]) => <Section key={key} name={key} value={value} />)
        )}
      </CardContent>
    </Card>
  );
}
