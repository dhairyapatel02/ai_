import type { ReactNode } from 'react';

/** Print views (S10 `/career/print`): no shell, black on white. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="print-sheet">{children}</div>;
}
