'use client';

import { isHttpUrl, type EvidenceItem } from '@devimpact/shared';
import { ExternalLink, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Short label for a ref: `PR-acme/api#42` → `api #42`, `C-acme/api@abc1234` → `api@abc1234`. */
export function shortRef(ref: string): string {
  const body = ref.replace(/^(PR|REV|C|ACH)-/, '');
  const repo = body.split('/').pop() ?? body;
  return repo.replace('#', ' #');
}

const KIND_LABEL: Record<EvidenceItem['kind'], string> = {
  pull_request: 'Pull request',
  review: 'Review',
  commit: 'Commit',
  achievement: 'Achievement',
};

/** Activity drawer link for an evidence record (S7 `?item=`), where one exists. */
function detailsHref(item: EvidenceItem): string | null {
  if (item.kind === 'pull_request') return `/activity?item=pr_merged:${item.id}`;
  if (item.kind === 'commit') return `/activity?item=commit:${item.id}`;
  return null;
}

const chipClass =
  'inline-flex h-6 items-center rounded-xs border px-1.5 align-baseline font-mono text-[11.5px] leading-none';

/**
 * Evidence chip (DESIGN_SYSTEM §5.2 EvidenceChip, S16 citations): a button with the short ref
 * (full ref in its accessible name) that opens a popover with the record's title, repository,
 * date, type, a GitHub link and "Details" (Activity drawer). Refs the server could not resolve
 * (e.g. a deleted PR) still show, without a popover body beyond the ref.
 */
export function EvidenceChip({
  refId,
  evidence,
  className,
}: {
  refId: string;
  evidence?: EvidenceItem | null;
  className?: string;
}) {
  const details = evidence ? detailsHref(evidence) : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Evidence ${refId}`}
          className={cn(
            chipClass,
            'cursor-pointer border-border-strong text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            className,
          )}
        >
          {shortRef(refId)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start" aria-label="Evidence">
        <div className="flex flex-col gap-2">
          <span className={cn(chipClass, 'self-start border-border-strong text-muted-foreground')}>
            {refId}
          </span>
          {evidence ? (
            <>
              <p className="text-base font-semibold">{evidence.title}</p>
              <p className="text-caption text-subtle-foreground">
                {[
                  KIND_LABEL[evidence.kind],
                  evidence.repo,
                  formatDate(evidence.occurredAt, { withYear: true }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="flex flex-wrap gap-2">
                {evidence.url && isHttpUrl(evidence.url) ? (
                  <Button size="sm" variant="secondary" asChild>
                    <a href={evidence.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" />
                      GitHub
                    </a>
                  </Button>
                ) : null}
                {details ? (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={details}>Details</Link>
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-caption text-subtle-foreground">
              This record is no longer available — it may have been deleted or excluded.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "No evidence linked" chip for uncited / invalid claims (S16 flags). */
export function NoEvidenceChip({ invalid = false }: { invalid?: boolean }) {
  return (
    <span
      className={cn(chipClass, 'gap-1 border-warning/40 bg-warning-soft font-sans text-warning')}
      title={invalid ? 'The cited record is not part of this document’s evidence' : undefined}
    >
      <TriangleAlert className="size-3" aria-hidden="true" />
      No evidence linked
    </span>
  );
}
