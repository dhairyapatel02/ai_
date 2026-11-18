import { Activity } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/** Logo mark (accent tile + activity icon) — prototype `.brand-mark`. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground',
        className,
      )}
      aria-hidden="true"
    >
      <Activity className="size-3.5" strokeWidth={2.25} />
    </span>
  );
}

export function Wordmark({ href, className }: { href?: string; className?: string }) {
  const content = (
    <>
      <BrandMark />
      <span className="text-base font-semibold tracking-tight">DevImpact</span>
    </>
  );
  if (!href)
    return <span className={cn('inline-flex items-center gap-2', className)}>{content}</span>;
  return (
    <Link
      href={href}
      className={cn('inline-flex items-center gap-2 rounded-sm text-foreground', className)}
    >
      {content}
    </Link>
  );
}
