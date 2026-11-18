'use client';

import { useId, useState, type ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Card for a chart (DESIGN_SYSTEM §6): title, optional description and actions, the chart (which
 * carries `role="img"` + an `aria-label` summary), and a "View as table" toggle that reveals the
 * same data as a real `<table>` — tooltips are never the only way to read values.
 */
export function ChartCard({
  title,
  description,
  actions,
  table,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** The data as a table (rendered only when toggled on). */
  table?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle>
            <h2>{title}</h2>
          </CardTitle>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        {children}
        {table ? (
          <>
            <button
              type="button"
              className="mt-3 cursor-pointer text-sm text-link underline underline-offset-2"
              aria-expanded={showTable}
              aria-controls={tableId}
              onClick={() => {
                setShowTable((v) => !v);
              }}
            >
              {showTable ? 'Hide table' : 'View as table'}
            </button>
            <div id={tableId} hidden={!showTable} className="mt-3 overflow-x-auto">
              {showTable ? table : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
