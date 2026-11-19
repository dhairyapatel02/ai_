'use client';

/**
 * Tooltip body for every plot (dataviz interaction rules): the value leads, the series name
 * follows; series keyed by a short stroke of the series colour; total for stacked columns.
 * Mouse convenience only (`aria-hidden`) — every value is also in the "View as table" toggle.
 */
export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export function ChartTooltipBox({
  title,
  rows,
  total,
}: {
  title: string;
  rows: TooltipRow[];
  total?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="min-w-36 rounded-md border bg-popover px-3 py-2 text-caption text-popover-foreground shadow-md"
    >
      <p className="mb-1 font-medium text-foreground">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.color ? (
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ background: row.color }}
                />
              ) : null}
              {row.label}
            </span>
            <b className="font-semibold text-foreground tabular-nums">{row.value}</b>
          </li>
        ))}
        {total !== undefined ? (
          <li className="mt-0.5 flex justify-between gap-4 border-t pt-0.5 text-muted-foreground">
            <span>Total</span>
            <b className="font-semibold text-foreground tabular-nums">{total}</b>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
