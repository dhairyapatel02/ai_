import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Badge (DESIGN_SYSTEM §5.1): 22 px, 12 px text, radius 4 px. Status badges (success/warning/danger)
 * always carry an icon *and* text — colour is never the only signal (WCAG 1.4.1).
 */
const badgeVariants = cva(
  'inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border border-transparent px-2 text-caption font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-2 text-muted-foreground',
        accent: 'bg-accent text-accent-foreground',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-destructive-soft text-destructive',
        outline: 'border-border-strong text-muted-foreground',
        // shadcn aliases used by vendored components
        default: 'bg-accent text-accent-foreground',
        secondary: 'bg-surface-2 text-muted-foreground',
        destructive: 'bg-destructive-soft text-destructive',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

function Badge({
  className,
  variant = 'neutral',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
