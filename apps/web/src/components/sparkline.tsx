/**
 * 6-period trend (DESIGN_SYSTEM §5.2 Sparkline): 96 × 28, de-emphasis line, accent end dot, gaps
 * for insufficient periods. `aria-hidden` — the value is in the row and the drawer has a table.
 */
export function sparklinePath(values: (number | null)[], width = 96, height = 28): string {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return '';
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const x = (i: number) => 3 + ((width - 6) * i) / Math.max(1, values.length - 1);
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
}) {
  const d = sparklinePath(values, width, height);
  if (!d) return <span className="text-caption text-subtle-foreground">No trend yet</span>;
  const nums = values.filter((v): v is number => v !== null);
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const last = values.at(-1);
  const lx = width - 3;
  const ly =
    last === null || last === undefined ? null : height - 4 - ((last - min) / span) * (height - 8);
  return (
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      className="shrink-0"
      data-testid="sparkline"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--chart-muted)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {ly !== null ? <circle cx={lx} cy={ly} r={3} fill="var(--chart-5)" /> : null}
    </svg>
  );
}
