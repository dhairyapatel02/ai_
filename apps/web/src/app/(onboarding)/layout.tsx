import Link from 'next/link';


import { Wordmark } from '@/components/brand';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';

import type { ReactNode } from 'react';

/** Onboarding wizard frame (SCREENS S2–S5): brand, theme, "Finish later", 720 px column. */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-(--reading-max) flex-col px-4 py-6 sm:py-10">
      <header className="mb-7 flex items-center gap-2">
        <Wordmark />
        <span className="flex-1" />
        <ThemeToggle />
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">Finish later</Link>
        </Button>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-hidden">
        {children}
      </main>
    </div>
  );
}
