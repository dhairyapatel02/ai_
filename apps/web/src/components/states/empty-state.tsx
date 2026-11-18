import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';


/**
 * Designed empty state (DESIGN_SYSTEM §5.2, §9): icon tile, title, one-sentence reason, primary +
 * secondary action. "What's missing + why it matters + one action".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  children,
  headingLevel = 2,
  align = 'center',
  className,
}: {
  icon?: LucideIcon | ((props: { className?: string }) => ReactNode);
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  align?: 'center' | 'start';
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-6 py-10',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-10 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <Heading
        className={cn('font-semibold tracking-tight', headingLevel === 1 ? 'text-xl' : 'text-lg')}
      >
        {title}
      </Heading>
      {description ? (
        <p className="max-w-[56ch] text-base text-muted-foreground">{description}</p>
      ) : null}
      {children}
      {actions ? (
        <div
          className={cn(
            'mt-1 flex flex-wrap gap-2',
            align === 'center' ? 'justify-center' : 'justify-start',
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
