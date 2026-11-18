import { cn } from '@/lib/utils';

/** Short label for a ref: `PR-acme/api#42` → `api #42`, `C-acme/api@abc1234` → `api@abc1234`. */
export function shortRef(ref: string): string {
  const body = ref.replace(/^(PR|REV|C|ACH)-/, '');
  const repo = body.split('/').pop() ?? body;
  return repo.replace('#', ' #');
}

/**
 * Evidence chip (DESIGN_SYSTEM §2 signature, §5.2 EvidenceChip): mono short ref, hairline, full ref
 * in the accessible name. The citation popover (title, repo, date, GitHub link) is P11.
 */
export function EvidenceChip({
  refId,
  flagged = false,
  className,
}: {
  refId: string;
  flagged?: boolean;
  className?: string;
}) {
  return (
    <span
      role="note"
      aria-label={`Evidence ${refId}`}
      className={cn(
        'inline-flex h-6 items-center rounded-xs border px-1.5 font-mono text-[11.5px]',
        flagged
          ? 'border-warning/40 bg-warning-soft text-warning'
          : 'border-border-strong text-muted-foreground',
        className,
      )}
    >
      {shortRef(refId)}
    </span>
  );
}
