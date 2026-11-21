import { cleanText, isHttpUrl, type ExportBlock, type ExportDocument } from '@devimpact/shared';

import { nativeRequire } from '../common/native-require';
import { fontSources, PDF_FONT } from './fonts';

import type * as ReactPdf from '@react-pdf/renderer' with { 'resolution-mode': 'import' };
import type * as ReactNs from 'react';

/**
 * PDF renderer (ADR-0012): `@react-pdf/renderer` on the server, no headless browser. The
 * package is ESM-only; it is loaded lazily with Node's native `require` (Node 22 `require(esm)`)
 * so API start-up stays fast and Jest (CommonJS) can run it without transforming it. React comes
 * from the same loader so elements and the reconciler share one React instance.
 */
const requireNative = nativeRequire(__filename);

interface Runtime {
  pdf: typeof ReactPdf;
  h: typeof ReactNs.createElement;
}

let runtime: Runtime | null = null;

function load(): Runtime {
  if (runtime) return runtime;
  const pdf = requireNative('@react-pdf/renderer') as typeof ReactPdf;
  const react = requireNative('react') as typeof ReactNs;
  for (const source of fontSources()) pdf.Font.register(source);
  // Never hyphenate (names, refs and code-like words must stay intact).
  pdf.Font.registerHyphenationCallback((word) => [word]);
  runtime = { pdf, h: react.createElement };
  return runtime;
}

// Light palette from design/tokens.css (print is always light).
const C = {
  text: '#1c1f24',
  muted: '#5b616e',
  subtle: '#8a909c',
  rule: '#e3e5e9',
  accent: '#3a4fd8',
  well: '#f5f6f8',
};

export type PageSize = 'A4' | 'LETTER';

/** Letter for time zones in the Americas, A4 elsewhere (ADR-0012 "by user locale"). */
export function pageSizeFor(timezone: string | null | undefined): PageSize {
  return timezone?.startsWith('America/') ? 'LETTER' : 'A4';
}

export async function renderPdf(doc: ExportDocument, size: PageSize = 'A4'): Promise<Buffer> {
  const { pdf, h } = load();
  const { Document, Page, Text, View, Link, StyleSheet, renderToBuffer } = pdf;
  const sans = [PDF_FONT.sans, PDF_FONT.sansExt];
  const s = StyleSheet.create({
    page: {
      paddingTop: 56,
      paddingBottom: 64,
      paddingHorizontal: 60,
      fontFamily: sans,
      fontSize: 10.5,
      lineHeight: 1.5,
      color: C.text,
    },
    eyebrow: { fontSize: 8.5, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
    title: { fontSize: 20, fontWeight: 600, lineHeight: 1.25, marginTop: 6 },
    rule: { borderBottomWidth: 0.75, borderBottomColor: C.rule, marginTop: 14, marginBottom: 4 },
    h2: { fontSize: 12.5, fontWeight: 600, marginTop: 18, marginBottom: 6 },
    para: { marginBottom: 6 },
    note: { fontSize: 8.5, color: C.muted, marginTop: 4, marginBottom: 4 },
    sup: { fontSize: 7, color: C.accent },
    li: { flexDirection: 'row', marginBottom: 5 },
    bullet: { width: 12, color: C.muted },
    liBody: { flex: 1 },
    liTitle: { fontWeight: 600 },
    table: { borderTopWidth: 0.75, borderTopColor: C.rule, marginTop: 2 },
    tr: {
      flexDirection: 'row',
      borderBottomWidth: 0.75,
      borderBottomColor: C.rule,
      paddingVertical: 4,
    },
    th: { flex: 1, fontSize: 9, color: C.muted, fontWeight: 500 },
    tdLabel: { flex: 1 },
    tdValue: { width: 120, textAlign: 'right', fontWeight: 500 },
    evidenceTitle: { fontSize: 12.5, fontWeight: 600, marginTop: 22, marginBottom: 6 },
    fn: { flexDirection: 'row', marginBottom: 4, fontSize: 8.5, lineHeight: 1.4 },
    fnNumber: { width: 18, color: C.muted },
    mono: { fontFamily: PDF_FONT.mono, fontSize: 8 },
    link: { color: C.accent, textDecoration: 'none' },
    footer: {
      position: 'absolute',
      bottom: 30,
      left: 60,
      right: 60,
      flexDirection: 'row',
      justifyContent: 'space-between',
      fontSize: 8,
      color: C.subtle,
    },
  });

  const notes = (ns: number[]) =>
    ns.length ? h(Text, { style: s.sup }, ` ${ns.map((n) => `[${n}]`).join('')}`) : null;

  const block = (b: ExportBlock, i: number) => {
    switch (b.kind) {
      case 'heading':
        return h(Text, { key: i, style: s.h2, minPresenceAhead: 48 }, cleanText(b.text));
      case 'paragraph':
        return h(Text, { key: i, style: s.para }, cleanText(b.text), notes(b.notes));
      case 'list':
        return h(
          View,
          { key: i },
          b.items.map((item, j) =>
            h(
              View,
              { key: j, style: s.li, wrap: false },
              h(Text, { style: s.bullet }, '•'),
              h(
                Text,
                { style: s.liBody },
                item.title ? h(Text, { style: s.liTitle }, `${cleanText(item.title)}. `) : null,
                cleanText(item.text),
                notes(item.notes),
              ),
            ),
          ),
        );
      case 'table':
        return h(
          View,
          { key: i, style: s.table },
          h(
            View,
            { style: s.tr },
            h(Text, { style: s.th }, b.columns[0]),
            h(Text, { style: [s.th, { textAlign: 'right' }] }, b.columns[1]),
          ),
          b.rows.map(([k, v], j) =>
            h(
              View,
              { key: j, style: s.tr, wrap: false },
              h(Text, { style: s.tdLabel }, cleanText(k)),
              h(Text, { style: s.tdValue }, cleanText(v)),
            ),
          ),
        );
      case 'note':
        return h(Text, { key: i, style: s.note }, cleanText(b.text));
    }
  };

  const footnotes = doc.footnotes.length
    ? h(
        View,
        null,
        h(Text, { style: s.evidenceTitle, minPresenceAhead: 40 }, 'Evidence'),
        doc.footnotes.map((f) =>
          h(
            View,
            { key: f.n, style: s.fn, wrap: false },
            h(Text, { style: s.fnNumber }, `[${f.n}]`),
            h(
              Text,
              { style: { flex: 1 } },
              h(Text, { style: s.mono }, f.ref),
              f.title ? ` — ${cleanText(f.title)}` : '',
              f.url && isHttpUrl(f.url)
                ? h(Text, null, ' · ', h(Link, { src: f.url, style: s.link }, 'GitHub'))
                : null,
            ),
          ),
        ),
      )
    : null;

  const element = h(
    Document,
    {
      title: cleanText(doc.title),
      subject: cleanText(doc.subtitle),
      author: 'DevImpact',
      creator: 'DevImpact',
      producer: 'DevImpact',
      language: 'en',
    },
    h(
      Page,
      { size, style: s.page, wrap: true },
      h(Text, { style: s.eyebrow }, cleanText(doc.subtitle)),
      h(Text, { style: s.title }, cleanText(doc.title)),
      h(View, { style: s.rule }),
      doc.blocks.map(block),
      footnotes,
      h(
        View,
        { style: s.footer, fixed: true },
        h(Text, null, 'Written with DevImpact from GitHub activity'),
        h(Text, {
          render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `${pageNumber} / ${totalPages}`,
        }),
      ),
    ),
  );
  return renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
}
