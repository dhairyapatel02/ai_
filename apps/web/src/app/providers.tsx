'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getQueryClient } from '@/lib/api/query-client';

/**
 * Client providers for every route: theme (next-themes, `class` on <html>, system default, no
 * transition flash), TanStack Query, tooltips and toasts (sonner, bottom-right; above the mobile
 * bottom bar via `--toast-offset`).
 */
export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster
            position="bottom-right"
            closeButton
            mobileOffset={{ bottom: 'calc(var(--bottombar-height) + 12px)' }}
            toastOptions={{ duration: 5000 }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
