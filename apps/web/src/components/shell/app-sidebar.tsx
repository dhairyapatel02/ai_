'use client';

import { PanelLeft, Search } from 'lucide-react';

import { BrandMark, Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

import { NavLinks } from './nav-links';
import { useShell } from './shell-context';
import { SyncStatus } from './sync-status';
import { UserMenu } from './user-menu';

/**
 * Desktop sidebar (≥ 1024 px, IA §3.1): wordmark, search (⌘K), grouped nav, sync status and the
 * account button. Collapses to a 56 px icon rail (`[` shortcut, remembered per device).
 */
export function AppSidebar() {
  const { setPaletteOpen, collapsed, toggleCollapsed } = useShell();
  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-y-0 left-0 z-(--z-sidebar) hidden flex-col gap-3 border-r border-sidebar-border bg-sidebar py-3 lg:flex',
        collapsed ? 'w-(--sidebar-width-collapsed) px-2' : 'w-(--sidebar-width) px-3',
      )}
      data-collapsed={collapsed}
    >
      <div
        className={cn(
          'flex h-8 items-center',
          collapsed ? 'justify-center' : 'justify-between px-1',
        )}
      >
        {collapsed ? <BrandMark /> : <Wordmark href="/dashboard" />}
        {collapsed ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse sidebar"
            aria-keyshortcuts="["
            onClick={toggleCollapsed}
          >
            <PanelLeft aria-hidden="true" />
          </Button>
        )}
      </div>
      {collapsed ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="self-center"
          aria-label="Expand sidebar"
          aria-keyshortcuts="["
          onClick={toggleCollapsed}
        >
          <PanelLeft aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        className={cn(
          'text-muted-foreground',
          collapsed ? 'size-8 self-center px-0' : 'justify-start',
        )}
        aria-label={collapsed ? 'Search or jump to…' : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => {
          setPaletteOpen(true);
        }}
      >
        <Search aria-hidden="true" />
        {collapsed ? null : (
          <>
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </>
        )}
      </Button>
      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <NavLinks collapsed={collapsed} idPrefix="sidebar" />
      </div>
      <div className="flex flex-col gap-1 border-t border-sidebar-border pt-2">
        {collapsed ? null : <SyncStatus variant="sidebar" />}
        <UserMenu collapsed={collapsed} />
      </div>
    </nav>
  );
}
