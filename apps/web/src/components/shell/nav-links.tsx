'use client';

import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

import { hrefWithPeriod, isNavItemActive, NAV_GROUPS } from './nav-config';
import { StatusDot, useSyncDescriptor } from './sync-status';

/**
 * Grouped navigation (IA §3.1): small group labels, `aria-current="page"` on the active item
 * (child routes keep the parent active), `?period` carried between Overview pages, and state
 * badges only — an attention dot on Integrations.
 */
export function NavLinks({
  collapsed = false,
  onNavigate,
  idPrefix = 'nav',
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  idPrefix?: string;
}) {
  const pathname = usePathname();
  const period = useSearchParams().get('period');
  const sync = useSyncDescriptor();

  return (
    <div className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => {
        const labelId = `${idPrefix}-group-${group.label.toLowerCase()}`;
        return (
          <div key={group.label} role="group" aria-labelledby={labelId} className="flex flex-col">
            <span
              id={labelId}
              className={cn(
                'px-2.5 pb-1 text-caption font-medium text-subtle-foreground',
                collapsed && 'sr-only',
              )}
            >
              {group.label}
            </span>
            {group.items.map((item) => {
              const active = isNavItemActive(item.href, pathname);
              const attention = item.href === '/settings/integrations' && sync.attention;
              return (
                <Link
                  key={item.href}
                  href={hrefWithPeriod(item.href, period)}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-base text-sidebar-foreground hover:bg-surface-2',
                    active &&
                      'bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent',
                    collapsed && 'justify-center px-0',
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className={cn('flex-1 truncate', collapsed && 'sr-only')}>
                    {item.label}
                  </span>
                  {attention ? (
                    <>
                      <StatusDot tone={sync.tone} />
                      <span className="sr-only">(needs attention)</span>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Spinner badge for background work (e.g. a generation running) — P11 wires it to Documents. */
export function NavSpinner() {
  return <LoaderCircle className="size-3.5 animate-spin text-primary" aria-label="In progress" />;
}
