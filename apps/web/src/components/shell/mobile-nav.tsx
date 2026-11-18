'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { signOut } from '@/lib/sign-out';
import { cn } from '@/lib/utils';

import { BOTTOM_BAR, hrefWithPeriod, isNavItemActive } from './nav-config';
import { NavLinks } from './nav-links';
import { useShell } from './shell-context';
import { SyncStatus } from './sync-status';

/** Navigation drawer (< 1024 px): every destination, sync status and Sign out (IA §3.3–§3.4). */
export function NavDrawer() {
  const { navOpen, setNavOpen } = useShell();
  const queryClient = useQueryClient();
  return (
    <Sheet open={navOpen} onOpenChange={setNavOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[300px] max-w-[85vw] gap-0 bg-sidebar p-0"
      >
        <div className="flex h-(--topbar-height) items-center justify-between border-b border-sidebar-border px-3">
          <SheetTitle asChild>
            <div>
              <Wordmark />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">Navigation</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close navigation">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
          <NavLinks
            idPrefix="drawer"
            onNavigate={() => {
              setNavOpen(false);
            }}
          />
          <div role="group" aria-labelledby="drawer-group-account" className="mt-4 flex flex-col">
            <span
              id="drawer-group-account"
              className="px-2.5 pb-1 text-caption font-medium text-subtle-foreground"
            >
              Account
            </span>
            <button
              type="button"
              className="flex h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-base hover:bg-surface-2"
              onClick={() => {
                void signOut(queryClient);
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </nav>
        <div className="pb-safe border-t border-sidebar-border p-3">
          <SyncStatus variant="sidebar" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Bottom tab bar (< 768 px): Home, Activity, KPIs, Docs, More (opens the drawer). */
export function BottomBar() {
  const pathname = usePathname();
  const period = useSearchParams().get('period');
  const { setNavOpen } = useShell();
  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-(--z-sidebar) flex border-t bg-surface md:hidden"
    >
      {BOTTOM_BAR.map((item) => {
        const active = isNavItemActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={hrefWithPeriod(item.href, period)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-(--bottombar-height) flex-1 flex-col items-center justify-center gap-0.5 text-caption text-muted-foreground',
              active && 'font-medium text-accent-foreground',
            )}
          >
            <item.icon className="size-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        className="flex h-(--bottombar-height) flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-caption text-muted-foreground"
        aria-label="More navigation"
        onClick={() => {
          setNavOpen(true);
        }}
      >
        <Menu className="size-5" aria-hidden="true" />
        More
      </button>
    </nav>
  );
}
