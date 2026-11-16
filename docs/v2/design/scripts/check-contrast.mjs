#!/usr/bin/env node
// Checks WCAG 2.2 contrast for every text/UI token pair in docs/v2/design/tokens.css, in both themes.
// Usage: node docs/v2/design/scripts/check-contrast.mjs [--md]
// Exit code 1 if any pair is below its threshold. `--md` prints the Markdown table used in
// DESIGN_SYSTEM.md §4.4.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'tokens.css'), 'utf8');

function block(selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`block ${selector} not found`);
  const end = css.indexOf('\n}', start);
  const vars = {};
  for (const m of css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
  return vars;
}
const light = block(':root');
const dark = { ...light, ...block('.dark') };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground token, background token, minimum, role]
const TEXT = 4.5, UI = 3, ORD = 2;
const pairs = [
  ['foreground', 'background', TEXT, 'Body text on canvas'],
  ['foreground', 'surface', TEXT, 'Body text on card'],
  ['foreground', 'surface-2', TEXT, 'Body text on sunken/hover'],
  ['foreground', 'surface-3', TEXT, 'Body text on selected row'],
  ['muted-foreground', 'background', TEXT, 'Secondary text on canvas'],
  ['muted-foreground', 'surface', TEXT, 'Secondary text on card'],
  ['muted-foreground', 'surface-2', TEXT, 'Secondary text on sunken/hover'],
  ['subtle-foreground', 'background', TEXT, 'Tertiary text on canvas'],
  ['subtle-foreground', 'surface', TEXT, 'Tertiary text on card'],
  ['subtle-foreground', 'surface-2', TEXT, 'Tertiary text on sunken (placeholder in filled input)'],
  ['sidebar-foreground', 'sidebar', TEXT, 'Nav text on sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent', TEXT, 'Active nav item'],
  ['primary-foreground', 'primary', TEXT, 'Primary button label'],
  ['primary-foreground', 'primary-hover', TEXT, 'Primary button label (hover)'],
  ['accent-foreground', 'accent', TEXT, 'Selected chip / soft accent'],
  ['link', 'surface', TEXT, 'Link on card'],
  ['link', 'background', TEXT, 'Link on canvas'],
  ['secondary-foreground', 'secondary', TEXT, 'Secondary button label'],
  ['destructive-foreground', 'destructive', TEXT, 'Destructive button label'],
  ['destructive', 'surface', TEXT, 'Error text on card'],
  ['destructive', 'destructive-soft', TEXT, 'Error text in error banner'],
  ['success', 'surface', TEXT, 'Success text on card'],
  ['success', 'success-soft', TEXT, 'Success text in banner'],
  ['warning', 'surface', TEXT, 'Warning text on card'],
  ['warning', 'warning-soft', TEXT, 'Warning text in banner'],
  ['info', 'info-soft', TEXT, 'Info text in banner'],
  ['input', 'surface', UI, 'Form control border on card'],
  ['input', 'background', UI, 'Form control border on canvas'],
  ['ring', 'surface', UI, 'Focus ring on card'],
  ['ring', 'background', UI, 'Focus ring on canvas'],
  ['primary', 'surface', UI, 'Primary button / switch-on / selected marker vs card'],
  ['success', 'surface', UI, 'Status dot (ok) vs card'],
  ['warning', 'surface', UI, 'Status dot (warning) vs card'],
  ['destructive', 'surface', UI, 'Status dot (error) vs card'],
  ['chart-1', 'surface', UI, 'Chart series 1'],
  ['chart-2', 'surface', UI, 'Chart series 2'],
  ['chart-3', 'surface', UI, 'Chart series 3'],
  ['chart-5', 'surface', UI, 'Single-series emphasis / line'],
  ['heat-1', 'surface', ORD, 'Heatmap lowest active step (ordinal floor 2:1)'],
];

let failures = 0;
const rows = [];
for (const [fg, bg, min, role] of pairs) {
  const lr = ratio(light[fg], light[bg]);
  const dr = ratio(dark[fg], dark[bg]);
  const ok = lr >= min && dr >= min;
  if (!ok) failures++;
  rows.push({ fg, bg, min, role, lr, dr, ok, lh: [light[fg], light[bg]], dh: [dark[fg], dark[bg]] });
}

if (process.argv.includes('--md')) {
  console.log('| Pair (foreground on background) | Role | Min | Light | Dark | Result |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows)
    console.log(
      `| \`${r.fg}\` on \`${r.bg}\` | ${r.role} | ${r.min}:1 | ${r.lr.toFixed(2)} (${r.lh.join(' / ')}) | ${r.dr.toFixed(2)} (${r.dh.join(' / ')}) | ${r.ok ? '✅' : '❌'} |`,
    );
} else {
  for (const r of rows)
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.fg} on ${r.bg}  light ${r.lr.toFixed(2)}  dark ${r.dr.toFixed(2)}  (min ${r.min})`);
}
console.error(`\n${rows.length - failures}/${rows.length} pairs pass in both themes.`);
process.exit(failures ? 1 : 0);
