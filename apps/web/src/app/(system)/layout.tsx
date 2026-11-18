import { Wordmark } from '@/components/brand';

import type { ReactNode } from 'react';


/** System pages without the shell (IA §2 "no UI beyond a spinner/error"). */
export default function SystemLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8">
      <Wordmark />
      <main id="main" className="flex flex-1 flex-col justify-center py-10">
        {children}
      </main>
    </div>
  );
}
