'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; columns without it are not sortable. */
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  className?: string;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

/**
 * Dense data table (DESIGN_SYSTEM §5.1 Table): sortable headers (`aria-sort`), client-side
 * pagination, 13 px cells, and stacked label/value rows below 768 px (no horizontal page scroll).
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  pageSize = 20,
  initialSort = null,
  empty = 'Nothing to show.',
  className,
}: {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  initialSort?: SortState;
  empty?: ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * factor;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) =>
      s?.key === key
        ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' },
    );
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-border-strong">
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const ariaSort = active
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : column.sortValue
                  ? 'none'
                  : undefined;
              const SortIcon = !active
                ? ArrowUpDown
                : sort.direction === 'asc'
                  ? ArrowUp
                  : ArrowDown;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    'px-3 py-2 font-medium text-muted-foreground',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 rounded-xs hover:text-foreground"
                      onClick={() => {
                        toggleSort(column.key);
                      }}
                    >
                      {column.header}
                      <SortIcon className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr
                key={rowKey(row)}
                className="flex flex-col gap-1 border-b py-2 md:table-row md:py-0"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'flex justify-between gap-4 px-3 md:table-cell md:py-2.5',
                      column.align === 'right' ? 'md:text-right' : 'md:text-left',
                      column.className,
                    )}
                  >
                    <span className="text-muted-foreground md:hidden" aria-hidden="true">
                      {column.header}
                    </span>
                    <span className="min-w-0 tabular-nums">{column.cell(row)}</span>
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {pages > 1 ? (
        <nav className="flex items-center justify-end gap-2" aria-label={`${caption} pages`}>
          <span className="text-caption text-subtle-foreground" aria-live="polite">
            Page {current + 1} of {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={current === 0}
            onClick={() => {
              setPage(current - 1);
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={current >= pages - 1}
            onClick={() => {
              setPage(current + 1);
            }}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
