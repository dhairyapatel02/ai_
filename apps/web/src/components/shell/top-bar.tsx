'use client';

import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';

import { routeMeta } from './nav-config';
import { NewMenu } from './new-menu';
import { PeriodPicker } from './period-picker';
import { useShell } from './shell-context';
import { SyncStatus } from './sync-status';
import { ThemeToggle } from './theme-toggle';

/**
 * Top bar (IA §3.2), left → right: menu (< 1024) · breadcrumb/title · period picker (period
 * pages only) · sync chip (desktop) · search (mobile) · theme toggle · New (≥ 768).
 */
export function TopBar({ title: titleOverride }: { title?: string }) {
  const pathname = usePathname();
  const meta = routeMeta(pathname);
  const { setNavOpen, setPaletteOpen } = useShell();
  const title = titleOverride ?? meta.title;
  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-(--topbar-height) items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        onClick={() => {
          setNavOpen(true);
        }}
      >
        <Menu aria-hidden="true" />
      </Button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-base">
          {meta.parent ? (
            <li className="hidden shrink-0 items-center gap-1.5 sm:flex">
              {meta.parent.href ? (
                <Link
                  href={meta.parent.href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {meta.parent.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">{meta.parent.label}</span>
              )}
              <span className="text-subtle-foreground" aria-hidden="true">
                /
              </span>
            </li>
          ) : null}
          <li className="min-w-0 truncate font-medium" aria-current="page">
            {title}
          </li>
        </ol>
      </nav>
      {meta.period ? <PeriodPicker /> : null}
      <SyncStatus variant="chip" className="hidden xl:inline-flex" />
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        aria-label="Search"
        onClick={() => {
          setPaletteOpen(true);
        }}
      >
        <Search aria-hidden="true" />
      </Button>
      <ThemeToggle />
      <NewMenu />
    </header>
  );
}
