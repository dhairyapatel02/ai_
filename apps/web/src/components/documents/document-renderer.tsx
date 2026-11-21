'use client';

import {
  formatMetricValue,
  writtenSections,
  type DocumentTypeWire,
  type EvidenceItem,
  type RenderItem,
  type RenderSection,
} from '@devimpact/shared';
import { Calculator } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { EvidenceChip, NoEvidenceChip } from '@/components/evidence-chip';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * DocumentRenderer (DESIGN_SYSTEM §5.2, S16): section headings, claims as text with evidence
 * chips, flagged claims (wavy underline + "No evidence linked"), engine metric tables (read-only,
 * calculator badge). LLM text is only ever rendered as React text — never as HTML or Markdown.
 * While streaming, the section being written shows its draft text with a caret on a soft
 * background, and sections not written yet keep their space with skeletons (no layout shift).
 */
export interface StreamingView {
  /** Key of the section being written. */
  currentKey: string | null;
  draft: string;
  /** Keys still to come (placeholder blocks). */
  pendingKeys: string[];
}

export function DocumentRenderer({
  type,
  sections,
  evidence,
  streaming,
  rewriting,
  renderItems,
}: {
  type: DocumentTypeWire;
  sections: RenderSection[];
  evidence: readonly EvidenceItem[];
  streaming?: StreamingView | null;
  /** Section being regenerated on its own (shows a skeleton instead of its content). */
  rewriting?: string | null;
  /** Custom item list for a section (resume bullet cards). */
  renderItems?: (section: Extract<RenderSection, { kind: 'items' }>) => ReactNode | null;
}) {
  const byRef = useMemo(() => new Map(evidence.map((e) => [e.ref, e])), [evidence]);
  const labels = useMemo(() => new Map(writtenSections(type).map((s) => [s.key, s.label])), [type]);
  const shownKeys = new Set(sections.map((s) => s.key));
  const draftOnly =
    streaming?.currentKey && !shownKeys.has(streaming.currentKey) ? streaming.currentKey : null;

  return (
    <div className="flex flex-col gap-7" data-testid="document-body">
      {sections.map((section) => {
        const writing = streaming?.currentKey === section.key;
        return (
          <section
            key={section.key}
            aria-labelledby={`sec-${section.key}`}
            className={cn(
              'flex flex-col gap-2.5 rounded-sm',
              writing && '-mx-3 bg-accent/40 px-3 py-2',
            )}
            data-section={section.key}
          >
            <SectionHeading id={`sec-${section.key}`} engine={section.kind === 'metrics'}>
              {section.label}
            </SectionHeading>
            {rewriting === section.key ? (
              <RewritingBlock />
            ) : section.kind === 'metrics' ? (
              <MetricsTable
                label={section.label}
                rows={section.metrics.map((m) => [m.label, formatMetricValue(m)])}
                engine
              />
            ) : section.kind === 'table' ? (
              <MetricsTable label={section.label} rows={section.rows} />
            ) : (
              (renderItems?.(section) ?? <Items section={section} byRef={byRef} />)
            )}
            {writing && streaming?.draft ? <Draft text={streaming.draft} /> : null}
          </section>
        );
      })}
      {draftOnly ? (
        <section
          className="-mx-3 flex flex-col gap-2.5 rounded-sm bg-accent/40 px-3 py-2"
          aria-labelledby={`sec-${draftOnly}`}
        >
          <SectionHeading id={`sec-${draftOnly}`}>
            {labels.get(draftOnly) ?? draftOnly}
          </SectionHeading>
          <Draft text={streaming?.draft ?? ''} />
        </section>
      ) : null}
      {streaming?.pendingKeys
        .filter((k) => k !== draftOnly && !shownKeys.has(k))
        .map((k) => (
          <section key={k} aria-hidden="true" className="flex flex-col gap-2.5 opacity-60">
            <span className="text-lg font-semibold text-subtle-foreground">
              {labels.get(k) ?? k}
            </span>
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-9/12" />
            <Skeleton className="h-4 w-10/12" />
          </section>
        ))}
    </div>
  );
}

function SectionHeading({
  id,
  engine = false,
  children,
}: {
  id: string;
  engine?: boolean;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
      {children}
      {engine ? <Badge variant="neutral">Engine</Badge> : null}
    </h2>
  );
}

function Draft({ text }: { text: string }) {
  return (
    <p className="text-md leading-relaxed text-muted-foreground">
      {text}
      <span
        aria-hidden="true"
        className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary motion-reduce:animate-none"
      />
    </p>
  );
}

function RewritingBlock() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="text-caption text-subtle-foreground">Rewriting this section…</span>
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-8/12" />
    </div>
  );
}

export function Citations({
  item,
  byRef,
  cited,
}: {
  item: RenderItem;
  byRef: Map<string, EvidenceItem>;
  cited: boolean;
}) {
  if (!cited) return null;
  return (
    <>
      {item.citations.map((ref) => (
        <EvidenceChip key={ref} refId={ref} evidence={byRef.get(ref) ?? null} className="ml-1" />
      ))}
      {item.flags.length ? (
        <span className="ml-1">
          <NoEvidenceChip invalid={item.flags.includes('invalid_citation')} />
        </span>
      ) : null}
    </>
  );
}

/** Claim text; flagged claims get a wavy warning underline (S16). */
export function ClaimText({ item, cited }: { item: RenderItem; cited: boolean }) {
  const flagged = cited && item.flags.length > 0;
  return (
    <span
      className={cn(flagged && 'underline decoration-warning decoration-wavy underline-offset-4')}
      data-flagged={flagged || undefined}
    >
      {item.text}
    </span>
  );
}

function Items({
  section,
  byRef,
}: {
  section: Extract<RenderSection, { kind: 'items' }>;
  byRef: Map<string, EvidenceItem>;
}) {
  if (section.shape === 'claim') {
    return (
      <>
        {section.items.map((item, i) => (
          <p key={item.id ?? i} className="text-md leading-relaxed">
            {item.title ? <strong className="font-semibold">{item.title}. </strong> : null}
            <ClaimText item={item} cited={section.cited} />
            <Citations item={item} byRef={byRef} cited={section.cited} />
          </p>
        ))}
      </>
    );
  }
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-subtle-foreground">
      {section.items.map((item, i) => (
        <li key={item.id ?? i} className="text-md leading-relaxed">
          {item.title ? <strong className="font-semibold">{item.title}. </strong> : null}
          <ClaimText item={item} cited={section.cited} />
          <Citations item={item} byRef={byRef} cited={section.cited} />
        </li>
      ))}
    </ul>
  );
}

function MetricsTable({
  label,
  rows,
  engine = false,
}: {
  label: string;
  rows: [string, string][];
  engine?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b text-caption text-subtle-foreground">
              <th scope="col" className="py-1.5 text-left font-medium">
                {engine ? 'Metric' : 'Item'}
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
                  {k}
                </th>
                <td className="py-1.5 text-right font-medium tabular-nums">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {engine ? (
        <p className="flex items-center gap-1.5 text-caption text-subtle-foreground">
          <Calculator className="size-3.5" aria-hidden="true" />
          Calculated by DevImpact from your GitHub data — not written by AI.
        </p>
      ) : null}
    </div>
  );
}
