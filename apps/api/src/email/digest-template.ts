/**
 * Weekly digest email (F-63): HTML (table layout, inline styles, light palette from the design
 * tokens) + plain text. Every user-, GitHub- and LLM-provided string goes through `esc()`; URLs
 * are built by the API and pass `safeHref()` (http/https only).
 */

export interface DigestMetric {
  key: string;
  label: string;
  value: number;
  previous: number | null;
}

export interface DigestLinkItem {
  title: string;
  repo: string | null;
  ref: string;
  url: string | null;
}

export interface DigestContent {
  name: string;
  timezone: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  metrics: DigestMetric[];
  notable: DigestLinkItem[];
  /** Merged PRs with no achievement yet; `url` opens the Activity drawer ("Turn into achievement"). */
  suggestions: DigestLinkItem[];
  achievementsLogged: number;
  summary: { text: string; highlights: string[] } | null;
  links: { dashboard: string; achievements: string; settings: string; unsubscribe: string };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  bg: '#f7f7f8',
  surface: '#ffffff',
  border: '#e4e4e7',
  fg: '#18181b',
  muted: '#52525b',
  subtle: '#71717a',
  accent: '#4338ca',
  well: '#f4f4f5',
};

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Control and bidi-override characters never reach an email (header or body). */
export function clean(value: string, max = 300): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '');
  const single = stripped.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const n = (v: number) => v.toLocaleString('en-US');

function delta(m: DigestMetric): string {
  if (m.previous === null) return '';
  const d = m.value - m.previous;
  if (d === 0) return 'no change vs the week before';
  return `${d > 0 ? 'up' : 'down'} ${n(Math.abs(d))} vs the week before`;
}

function lede(c: DigestContent): string {
  const v = (k: string) => c.metrics.find((m) => m.key === k)?.value ?? 0;
  const merged = v('prs_merged');
  const reviewed = v('prs_reviewed');
  const repos = v('repos_contributed');
  const pr = (x: number) => (x === 1 ? 'pull request' : 'pull requests');
  if (merged === 0 && reviewed === 0 && v('commits') === 0) {
    return 'A quiet week on GitHub — no merged pull requests, reviews or commits.';
  }
  return `You merged ${n(merged)} ${pr(merged)} and reviewed ${n(reviewed)} across ${n(repos)} ${repos === 1 ? 'repository' : 'repositories'}.`;
}

export function renderDigest(c: DigestContent): RenderedEmail {
  const subject = clean(`Your week: ${c.weekLabel}`, 120);
  const name = clean(c.name, 100) || 'there';
  const unsub = safeHref(c.links.unsubscribe) ?? '';

  const item = (i: DigestLinkItem, linkLabel: string) => {
    const href = safeHref(i.url);
    const title = esc(clean(i.title, 200));
    const meta = esc(
      [i.repo ? clean(i.repo, 120) : null, clean(i.ref, 140)].filter(Boolean).join(' · '),
    );
    return `<tr><td style="padding:8px 0;border-top:1px solid ${C.border};font-size:14px;line-height:20px;color:${C.fg}">${title}<br><span style="font-family:Menlo,Consolas,monospace;font-size:12px;color:${C.subtle}">${meta}</span>${href ? ` · <a href="${esc(href)}" style="color:${C.accent};font-size:12px">${esc(linkLabel)}</a>` : ''}</td></tr>`;
  };

  const metricCells = c.metrics
    .map(
      (m) =>
        `<td style="padding:12px;border:1px solid ${C.border};border-radius:8px;background:${C.surface};width:25%;vertical-align:top"><div style="font-size:12px;color:${C.muted}">${esc(m.label)}</div><div style="font-size:22px;font-weight:600;color:${C.fg};padding-top:2px">${n(m.value)}</div><div style="font-size:11px;color:${C.subtle}">${esc(delta(m))}</div></td>`,
    )
    .join('<td style="width:8px"></td>');

  const summaryHtml = c.summary
    ? `<tr><td style="padding:16px 0 0"><div style="background:${C.well};border-radius:8px;padding:12px 14px"><div style="font-size:12px;color:${C.subtle};padding-bottom:4px">Summary · written by AI from your activity</div><div style="font-size:14px;line-height:21px;color:${C.fg}">${esc(clean(c.summary.text, 600))}</div>${c.summary.highlights.length ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:14px;line-height:21px;color:${C.fg}">${c.summary.highlights.map((h) => `<li>${esc(clean(h, 300))}</li>`).join('')}</ul>` : ''}</div></td></tr>`
    : '';

  const section = (title: string, rows: string) =>
    `<tr><td style="padding:20px 0 4px;font-size:14px;font-weight:600;color:${C.fg}">${esc(title)}</td></tr>${rows}`;

  const notableHtml = c.notable.length
    ? section('Notable pull requests', c.notable.map((i) => item(i, 'Open on GitHub')).join(''))
    : '';
  const suggestionsHtml = section(
    'Worth capturing',
    c.suggestions.length
      ? c.suggestions.map((i) => item(i, 'Capture this')).join('')
      : `<tr><td style="padding:8px 0;border-top:1px solid ${C.border};font-size:14px;color:${C.muted}">No merged PRs waiting to become achievements. Log mentoring, incidents or design work on the <a href="${esc(safeHref(c.links.achievements) ?? '')}" style="color:${C.accent}">Achievements page</a>.</td></tr>`,
  );
  const achievementsLine =
    c.achievementsLogged > 0
      ? `<tr><td style="padding:12px 0 0;font-size:13px;color:${C.muted}">You logged ${n(c.achievementsLogged)} ${c.achievementsLogged === 1 ? 'achievement' : 'achievements'} this week.</td></tr>`
      : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.surface};border:1px solid ${C.border};border-radius:12px"><tr><td style="padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:12px;color:${C.subtle}">DevImpact · Weekly digest</td></tr>
<tr><td style="padding:6px 0 0;font-size:20px;font-weight:600;color:${C.fg}">Your week: ${esc(clean(c.weekLabel, 60))}</td></tr>
<tr><td style="padding:12px 0 0;font-size:14px;line-height:21px;color:${C.fg}">Hi ${esc(name)}, ${esc(lede(c))}</td></tr>
${summaryHtml}
<tr><td style="padding:16px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${metricCells}</tr></table></td></tr>
<tr><td style="padding:6px 0 0;font-size:11px;color:${C.subtle}">Numbers come from the DevImpact metrics engine, not the AI. Signal from your GitHub activity — not a judgement of your performance.</td></tr>
${achievementsLine}
${notableHtml}
${suggestionsHtml}
<tr><td style="padding:24px 0 0"><a href="${esc(safeHref(c.links.dashboard) ?? '')}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 16px;border-radius:8px">Open your dashboard</a></td></tr>
</table></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="padding:16px 8px;font-size:12px;line-height:18px;color:${C.subtle}">Week of ${esc(c.weekStart)} to ${esc(c.weekEnd)} in ${esc(clean(c.timezone, 64))}. <a href="${esc(unsub)}" style="color:${C.subtle}">Unsubscribe from the weekly digest</a> with one click — no sign-in needed. <a href="${esc(safeHref(c.links.settings) ?? '')}" style="color:${C.subtle}">Email settings</a>.</td></tr></table>
</td></tr></table>
</body></html>`;

  const lines: string[] = [
    `Your week: ${clean(c.weekLabel, 60)}`,
    '',
    `Hi ${name}, ${lede(c)}`,
    '',
  ];
  if (c.summary) {
    lines.push('Summary (written by AI from your activity):', clean(c.summary.text, 600));
    for (const h of c.summary.highlights) lines.push(`- ${clean(h, 300)}`);
    lines.push('');
  }
  for (const m of c.metrics) {
    const d = delta(m);
    lines.push(`${m.label}: ${n(m.value)}${d ? ` (${d})` : ''}`);
  }
  lines.push('Numbers come from the DevImpact metrics engine, not the AI.', '');
  if (c.achievementsLogged > 0) {
    lines.push(
      `You logged ${n(c.achievementsLogged)} ${c.achievementsLogged === 1 ? 'achievement' : 'achievements'} this week.`,
      '',
    );
  }
  const textItem = (i: DigestLinkItem) => {
    const href = safeHref(i.url);
    return `- ${clean(i.title, 200)} (${[i.repo ? clean(i.repo, 120) : null, clean(i.ref, 140)].filter(Boolean).join(' · ')})${href ? `\n  ${href}` : ''}`;
  };
  if (c.notable.length) lines.push('Notable pull requests:', ...c.notable.map(textItem), '');
  lines.push('Worth capturing:');
  if (c.suggestions.length) lines.push(...c.suggestions.map(textItem));
  else lines.push(`- Nothing waiting. Log other work at ${safeHref(c.links.achievements) ?? ''}`);
  lines.push(
    '',
    `Open your dashboard: ${safeHref(c.links.dashboard) ?? ''}`,
    '',
    `Week of ${c.weekStart} to ${c.weekEnd} in ${clean(c.timezone, 64)}.`,
    `Unsubscribe (no sign-in needed): ${unsub}`,
    `Email settings: ${safeHref(c.links.settings) ?? ''}`,
  );
  return { subject, html, text: lines.join('\n') };
}
