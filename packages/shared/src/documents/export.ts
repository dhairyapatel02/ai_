import {
  DOCUMENT_TYPE_LABELS,
  documentSections,
  formatMetricValue,
  type RenderSection,
} from './render';

import type { DocumentTypeWire } from '../api/documents';
import type { EvidenceItem } from '../api/metrics';

/**
 * Export-blocks IR (ADR-0012): one representation of a document version that the Markdown and
 * plain-text serializers here, and the PDF/DOCX renderers in the API, all consume. Text is kept
 * as plain strings; each serializer escapes for its own format.
 */

export type ExportFormat = 'md' | 'txt' | 'pdf' | 'docx';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface ExportListItem {
  title: string | null;
  text: string;
  /** Footnote numbers (empty when citations are omitted). */
  notes: number[];
  /** Claim without (valid) evidence. */
  flagged: boolean;
}

export type ExportBlock =
  | { kind: 'heading'; text: string; engine: boolean }
  | { kind: 'paragraph'; text: string; notes: number[]; flagged: boolean }
  | { kind: 'list'; items: ExportListItem[] }
  | { kind: 'table'; columns: [string, string]; rows: [string, string][] }
  | { kind: 'note'; text: string };

export interface ExportFootnote {
  n: number;
  ref: string;
  title: string | null;
  url: string | null;
}

export interface ExportDocument {
  type: DocumentTypeWire;
  title: string;
  /** "Appraisal · H2 2026 · Version 3". */
  subtitle: string;
  blocks: ExportBlock[];
  footnotes: ExportFootnote[];
  legacy: boolean;
}

export interface ExportInput {
  type: DocumentTypeWire;
  title: string;
  periodLabel: string | null;
  version: number;
  content: unknown;
  evidence: readonly EvidenceItem[];
  /** Citations as footnotes. Default: true, except resume (paste-ready, ADR-0012). */
  citations?: boolean;
}

export const ENGINE_NOTE = 'Calculated by DevImpact from your GitHub data — not written by AI.';
export const LEGACY_NOTE = 'Imported from DevImpact v0.1. This version is read-only.';

export function includeCitationsByDefault(type: DocumentTypeWire): boolean {
  return type !== 'resume';
}

/** Builds the IR from a stored (or rendered) version. */
export function toExportDocument(input: ExportInput): ExportDocument {
  const withNotes = input.citations ?? includeCitationsByDefault(input.type);
  const rendered = documentSections(input.type, input.content);
  const byRef = new Map(input.evidence.map((e) => [e.ref, e]));
  const footnotes: ExportFootnote[] = [];
  const numberOf = new Map<string, number>();
  const notesFor = (refs: string[]): number[] => {
    if (!withNotes) return [];
    return refs.map((ref) => {
      const existing = numberOf.get(ref);
      if (existing) return existing;
      const n = footnotes.length + 1;
      const ev = byRef.get(ref);
      footnotes.push({ n, ref, title: ev?.title ?? null, url: ev?.url ?? null });
      numberOf.set(ref, n);
      return n;
    });
  };

  const blocks: ExportBlock[] = [];
  if (rendered.legacy) blocks.push({ kind: 'note', text: LEGACY_NOTE });
  for (const section of rendered.sections) blocks.push(...sectionBlocks(section, notesFor));

  const subtitle = [
    DOCUMENT_TYPE_LABELS[input.type],
    input.periodLabel,
    input.version > 0 ? `Version ${input.version}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    type: input.type,
    title: input.title,
    subtitle,
    blocks,
    footnotes,
    legacy: rendered.legacy,
  };
}

function sectionBlocks(section: RenderSection, notesFor: (refs: string[]) => number[]) {
  const out: ExportBlock[] = [];
  if (section.kind === 'metrics') {
    out.push({ kind: 'heading', text: section.label, engine: true });
    out.push({
      kind: 'table',
      columns: ['Metric', 'Value'],
      rows: section.metrics.map((m) => [m.label, formatMetricValue(m)]),
    });
    out.push({ kind: 'note', text: ENGINE_NOTE });
    return out;
  }
  if (section.kind === 'table') {
    out.push({ kind: 'heading', text: section.label, engine: false });
    out.push({ kind: 'table', columns: ['Item', 'Value'], rows: section.rows });
    return out;
  }
  out.push({ kind: 'heading', text: section.label, engine: false });
  if (section.shape === 'claim') {
    for (const item of section.items) {
      out.push({
        kind: 'paragraph',
        text: item.title ? `${item.title}. ${item.text}` : item.text,
        notes: notesFor(item.citations),
        flagged: section.cited && item.flags.length > 0,
      });
    }
    return out;
  }
  out.push({
    kind: 'list',
    items: section.items.map((item) => ({
      title: item.title,
      text: item.text,
      notes: notesFor(item.citations),
      flagged: section.cited && item.flags.length > 0,
    })),
  });
  return out;
}

// ── Serializers ─────────────────────────────────────────────────────────────────────────────

/** Single line, no control characters (LLM and user text never adds structure). */
export function cleanText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- strip C0/C1 controls and bidi overrides
      .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Escapes Markdown syntax so text (model output, user edits) is rendered literally wherever the
 * Markdown is pasted: no links, images, HTML, emphasis, code or headings can be injected.
 */
export function escapeMarkdown(text: string): string {
  return escapeInline(text)
    .replace(/^([#+-])/, '\\$1')
    .replace(/^(\d+)\./, '$1\\.');
}

/** Escaping for text that never starts a line (list items, table cells, headings). */
function escapeInline(text: string): string {
  return cleanText(text)
    .replace(/[\\`*_[\]<>|~]/g, '\\$&')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;');
}

const mdNotes = (notes: number[]) => notes.map((n) => `[^${n}]`).join('');
const txtNotes = (notes: number[]) => (notes.length ? ` [${notes.join(', ')}]` : '');

export function toMarkdown(doc: ExportDocument): string {
  const lines: string[] = [`# ${escapeInline(doc.title)}`, '', `_${escapeInline(doc.subtitle)}_`];
  for (const block of doc.blocks) {
    lines.push('');
    switch (block.kind) {
      case 'heading':
        lines.push(`## ${escapeInline(block.text)}`);
        break;
      case 'paragraph':
        lines.push(`${escapeMarkdown(block.text)}${mdNotes(block.notes)}`);
        break;
      case 'list':
        for (const item of block.items) {
          const title = item.title ? `**${escapeInline(item.title)}** — ` : '';
          lines.push(`- ${title}${escapeInline(item.text)}${mdNotes(item.notes)}`);
        }
        break;
      case 'table':
        lines.push(`| ${block.columns.map(escapeInline).join(' | ')} |`, '| --- | ---: |');
        for (const row of block.rows) lines.push(`| ${row.map(escapeInline).join(' | ')} |`);
        break;
      case 'note':
        lines.push(`_${escapeInline(block.text)}_`);
        break;
    }
  }
  if (doc.footnotes.length) {
    lines.push('');
    for (const f of doc.footnotes) {
      const title = f.title ? ` — ${escapeInline(f.title)}` : '';
      const url = f.url && isHttpUrl(f.url) ? ` <${f.url.replace(/[<>\s]/g, '')}>` : '';
      lines.push(`[^${f.n}]: \`${f.ref.replace(/`/g, '')}\`${title}${url}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function toPlainText(doc: ExportDocument): string {
  const lines: string[] = [cleanText(doc.title), cleanText(doc.subtitle)];
  for (const block of doc.blocks) {
    switch (block.kind) {
      case 'heading':
        lines.push('', cleanText(block.text).toUpperCase());
        break;
      case 'paragraph':
        lines.push(`${cleanText(block.text)}${txtNotes(block.notes)}`);
        break;
      case 'list':
        for (const item of block.items) {
          const title = item.title ? `${cleanText(item.title)}: ` : '';
          lines.push(`• ${title}${cleanText(item.text)}${txtNotes(item.notes)}`);
        }
        break;
      case 'table':
        for (const [k, v] of block.rows) lines.push(`${cleanText(k)}: ${cleanText(v)}`);
        break;
      case 'note':
        lines.push(cleanText(block.text));
        break;
    }
  }
  if (doc.footnotes.length) {
    lines.push('', 'EVIDENCE');
    for (const f of doc.footnotes) {
      const parts = [
        f.ref,
        f.title ? cleanText(f.title) : null,
        f.url && isHttpUrl(f.url) ? f.url : null,
      ];
      lines.push(`[${f.n}] ${parts.filter(Boolean).join(' — ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

// ── Filenames ───────────────────────────────────────────────────────────────────────────────

/** `half:2026-H2` → `2026-H2`; `custom:2025-11-21..2026-11-20` → `2025-11-21_2026-11-20`. */
export function periodSlug(spec: string | null | undefined): string {
  if (!spec) return 'undated';
  const body = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
  return body.replace('..', '_').replace(/[^A-Za-z0-9_-]/g, '') || 'undated';
}

/** `<type>-<period>-v<n>.<ext>` (ADR-0012), ASCII only — safe in `Content-Disposition`. */
export function exportFilename(
  type: DocumentTypeWire,
  periodSpec: string | null | undefined,
  version: number,
  format: ExportFormat,
): string {
  const kind = type.replace(/_/g, '-');
  return `${kind}-${periodSlug(periodSpec)}-v${Math.max(0, Math.trunc(version))}.${format}`;
}
