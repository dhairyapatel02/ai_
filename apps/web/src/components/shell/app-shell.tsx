'use client';

import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { AppSidebar } from './app-sidebar';
import { CommandPalette } from './command-palette';
import { BottomBar, NavDrawer } from './mobile-nav';
import { ShellProvider, useShell } from './shell-context';
import { ShortcutsDialog, useGlobalShortcuts } from './shortcuts';
import { SyncToaster } from './sync-toaster';
import { TopBar } from './top-bar';

function ShellFrame({ children, title }: { children: ReactNode; title?: string }) {
  const { collapsed } = useShell();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  useGlobalShortcuts();

  // After a route change, focus moves to <main> without a scroll jump (DESIGN_SYSTEM §10).
  // Compares paths (not a first-render flag) so StrictMode's double effects don't steal focus.
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <>
      <a
        href="#main"
        className="fixed top-2 left-2 z-(--z-tooltip) -translate-y-16 rounded-sm bg-primary px-3 py-2 text-primary-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <Suspense>
        <AppSidebar />
      </Suspense>
      <div
        className={cn(
          'flex min-h-dvh flex-col',
          collapsed ? 'lg:pl-(--sidebar-width-collapsed)' : 'lg:pl-(--sidebar-width)',
        )}
      >
        <Suspense>
          <TopBar title={title} />
        </Suspense>
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-(--content-max) flex-1 px-4 pt-6 pb-[calc(var(--bottombar-height)+env(safe-area-inset-bottom)+1.5rem)] focus:outline-hidden md:pb-10 lg:px-6"
        >
          {children}
        </main>
      </div>
      <Suspense>
        <BottomBar />
        <NavDrawer />
      </Suspense>
      <CommandPalette />
      <ShortcutsDialog />
      <SyncToaster />
    </>
  );
}

/**
 * App shell (DESIGN_SYSTEM §5.2 AppShell, IA §3): skip link, grouped sidebar ≥ 1024 px, drawer at
 * 768–1023 px, bottom bar + drawer < 768 px, top bar with period picker, ⌘K palette, shortcuts.
 */
export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <ShellProvider>
      <ShellFrame title={title}>{children}</ShellFrame>
    </ShellProvider>
  );
}
