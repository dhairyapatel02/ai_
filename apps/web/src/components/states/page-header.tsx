import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

/** Page title row (one `h1` per page) with an optional lede and actions that wrap on mobile (UX-02). */
export function PageHeader({
  title,
  lede,
  actions,
  className,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {lede ? <p className="mt-1 max-w-[70ch] text-base text-muted-foreground">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
