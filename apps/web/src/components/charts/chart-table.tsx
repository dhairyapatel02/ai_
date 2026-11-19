import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

/** The "View as table" body: a real `<table>` with a caption (DESIGN_SYSTEM §10 Charts). */
export function ChartTable({
  caption,
  headers,
  rows,
  className,
}: {
  caption: string;
  headers: string[];
  rows: { key: string; cells: ReactNode[] }[];
  className?: string;
}) {
  return (
    <table className={cn('w-full text-sm', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border-strong text-muted-foreground">
          {headers.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={cn('py-1.5 pr-3 font-medium', i === 0 ? 'text-left' : 'text-right')}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b last:border-b-0">
            {row.cells.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {cell}
                </th>
              ) : (
                <td key={i} className="py-1.5 pr-3 text-right tabular-nums">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
