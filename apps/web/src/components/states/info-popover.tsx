'use client';

import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import type { ReactNode } from 'react';

/**
 * "How is this calculated?" (DESIGN_SYSTEM §5.2, F-27): a 28 px info button that opens a popover
 * with the definition. Lives in the same place on every metric (consistent help, WCAG 3.2.6).
 */
export function InfoPopover({
  label,
  title,
  children,
}: {
  /** Accessible name, e.g. "How is PRs merged calculated?" */
  label: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-subtle-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-base" align="start">
        {title ? <p className="mb-1 font-semibold">{title}</p> : null}
        <div className="text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
