import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Button (DESIGN_SYSTEM §5.1): variants default (primary) · secondary (outline on surface) ·
 * ghost · destructive · destructive-outline · link; sizes sm 28 · default 32 · lg 40 · icon.
 * `loading` swaps the leading icon for a spinner, keeps the label and sets `aria-busy`.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm text-base font-medium whitespace-nowrap transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary:
          'border border-border-strong bg-surface text-foreground hover:bg-surface-2 active:bg-surface-3',
        outline:
          'border border-border-strong bg-surface text-foreground hover:bg-surface-2 active:bg-surface-3',
        ghost: 'text-foreground hover:bg-surface-2 active:bg-surface-3',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
        'destructive-outline':
          'border border-destructive bg-surface text-destructive hover:bg-destructive-soft',
        link: 'h-auto px-0 text-link underline underline-offset-2 hover:no-underline',
      },
      size: {
        sm: 'h-7 gap-1.5 px-2.5 text-sm',
        default: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: 'size-8',
        'icon-sm': 'size-7',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {React.Children.toArray(children).filter(
            (child) =>
              !(React.isValidElement(child) && child.type !== React.Fragment && isIcon(child)),
          )}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

/** Lucide icons render an <svg> with `aria-hidden`; while loading the spinner replaces them. */
function isIcon(child: React.ReactElement): boolean {
  const type = child.type as { displayName?: string; render?: { displayName?: string } };
  const name = type.displayName ?? type.render?.displayName ?? '';
  return /Icon$|^Lucide/.test(name) || (typeof child.type === 'string' && child.type === 'svg');
}

export { Button, buttonVariants };
export type { ButtonProps };
