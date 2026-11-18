import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Tone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

const TONES: Record<Tone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'border-info/25 bg-info-soft', icon: 'text-info', Icon: Info },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: 'text-warning', Icon: TriangleAlert },
  danger: {
    box: 'border-destructive/30 bg-destructive-soft',
    icon: 'text-destructive',
    Icon: CircleAlert,
  },
  success: { box: 'border-success/30 bg-success-soft', icon: 'text-success', Icon: CircleCheck },
  neutral: { box: 'border-border bg-surface-2', icon: 'text-muted-foreground', Icon: Info },
};

/**
 * Page-level status banner (DESIGN_SYSTEM §5.2): icon + title + body + actions. Status colour
 * always comes with an icon and text (WCAG 1.4.1). `role="alert"` only for errors the user just
 * caused; persistent state uses `status`.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  icon,
  role = 'status',
  className,
}: {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  role?: 'status' | 'alert' | 'none';
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={role === 'none' ? undefined : role}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-4 py-3',
        t.box,
        className,
      )}
    >
      <span className={cn('mt-0.5 shrink-0', t.icon)}>
        {icon ?? <t.Icon className="size-4" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className={cn('font-medium', tone === 'neutral' ? 'text-foreground' : t.icon)}>
          {title}
        </p>
        {children ? <div className="mt-0.5 text-base text-muted-foreground">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
