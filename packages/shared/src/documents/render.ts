import type { CitationFlag, DocumentTypeWire, StudioDocumentType } from '../api/documents';
import type { MetricValue } from '../api/metrics';

/**
 * Document structure shared by the web renderer (S16), clipboard copy and the API exports
 * (ADR-0012): one ordered list of sections per type, built from stored (or streaming, partial)
 * content. Content keys come back from JSONB in any order, so the order lives here.
 */

export type SectionShape =
  /** One claim rendered as a paragraph (`executiveSummary`, `whyReady`, resume `summary`). */
  | 'claim'
  /** A list of claims (`areasOfImpact`, resume `bullets`). */
  | 'claims'
  /** A list of claims with titles (`keyContributions`). */
  | 'titled'
  /** Forward-looking items without citations (`nextGoals`). */
  | 'plain'
  /** Engine-filled metric values (KPI §8) — read-only, never written by the model. */
  | 'metrics';

export interface SectionSpec {
  key: string;
  label: string;
  shape: SectionShape;
}

export const SECTION_SPECS: Record<
  StudioDocumentType | 'impact_narrative',
  readonly SectionSpec[]
> = {
  resume: [
    { key: 'summary', label: 'Summary', shape: 'claim' },
    { key: 'bullets', label: 'Resume bullets', shape: 'claims' },
  ],
  appraisal: [
    { key: 'executiveSummary', label: 'Executive summary', shape: 'claim' },
    { key: 'keyContributions', label: 'Key contributions', shape: 'titled' },
    { key: 'metrics', label: 'Metrics', shape: 'metrics' },
    { key: 'areasOfImpact', label: 'Areas of impact', shape: 'claims' },
    { key: 'growth', label: 'Growth', shape: 'claims' },
    { key: 'nextGoals', label: 'Next goals', shape: 'plain' },
  ],
  promotion: [
    { key: 'whyReady', label: "Why I'm ready", shape: 'claim' },
    { key: 'leadershipEvidence', label: 'Leadership', shape: 'claims' },
    { key: 'technicalImpact', label: 'Technical impact', shape: 'claims' },
    { key: 'businessValue', label: 'Business value', shape: 'claims' },
    { key: 'mentorship', label: 'Mentorship', shape: 'claims' },
    { key: 'supportingData', label: 'Supporting data', shape: 'metrics' },
  ],
  impact_narrative: [
    { key: 'summary', label: 'Summary', shape: 'claim' },
    { key: 'highlights', label: 'Highlights', shape: 'titled' },
    { key: 'focusAreas', label: 'Focus areas', shape: 'plain' },
  ],
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeWire, string> = {
  resume: 'Resume',
  appraisal: 'Appraisal',
  promotion: 'Promotion',
  impact_narrative: 'Impact highlights',
  achievement_statement: 'Achievement statement',
  digest_summary: 'Weekly digest',
};

/** Sections the model writes (streamed one by one); engine sections are merged afterwards. */
export function writtenSections(type: DocumentTypeWire): readonly SectionSpec[] {
  return specsFor(type).filter((s) => s.shape !== 'metrics');
}

function specsFor(type: DocumentTypeWire): readonly SectionSpec[] {
  return type in SECTION_SPECS ? SECTION_SPECS[type as keyof typeof SECTION_SPECS] : [];
}

export interface RenderItem {
  /** Stable item id (`b1`, `kc2`); absent while streaming. */
  id: string | null;
  /** Position in the stored array (null for single-claim sections). */
  index: number | null;
  title: string | null;
  text: string;
  citations: string[];
  flags: CitationFlag[];
  /** Resume bullets: theme badge, curation state. */
  theme: string | null;
  pinned: boolean;
  used: boolean;
}

export type RenderSection =
  | {
      kind: 'items';
      key: string;
      label: string;
      shape: Exclude<SectionShape, 'metrics'>;
      items: RenderItem[];
      /** Claims must cite evidence (false for plain, forward-looking items). */
      cited: boolean;
    }
  | { kind: 'metrics'; key: string; label: string; metrics: MetricValue[] }
  | { kind: 'table'; key: string; label: string; rows: [string, string][] };

export interface RenderedDocument {
  legacy: boolean;
  sections: RenderSection[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function toItem(raw: unknown, index: number | null, keepEmpty = false): RenderItem | null {
  if (!isObject(raw)) return null;
  const text = keepEmpty && typeof raw.text === 'string' ? raw.text : str(raw.text);
  if (text === null) return null;
  const flags = strings(raw.flags).filter(
    (f): f is CitationFlag => f === 'uncited' || f === 'invalid_citation',
  );
  return {
    id: str(raw.id),
    index,
    title: keepEmpty && typeof raw.title === 'string' ? raw.title : str(raw.title),
    text,
    citations: strings(raw.citations),
    flags,
    theme: str(raw.theme),
    pinned: raw.pinned === true,
    used: raw.used === true,
  };
}

const isMetricValue = (v: unknown): v is MetricValue =>
  isObject(v) && typeof v.key === 'string' && typeof v.label === 'string' && 'unit' in v;

/**
 * Ordered sections of a document version. Accepts partial content (streaming, missing keys are
 * skipped) and v0.1 imports (`{ legacy: true, raw }`, rendered as readable sections — never JSON).
 */
export function documentSections(
  type: DocumentTypeWire,
  content: unknown,
  /** Editor: keep items whose text was cleared (so the field stays on screen). */
  options: { keepEmpty?: boolean } = {},
): RenderedDocument {
  if (isObject(content) && content.legacy === true) {
    return { legacy: true, sections: legacySections(content.raw) };
  }
  const root = isObject(content) ? content : {};
  const body = isObject(root.sections) ? root.sections : root;
  const narrative = type === 'resume' && root.format === 'narrative';
  const sections: RenderSection[] = [];
  for (const spec of specsFor(type)) {
    const value = body[spec.key];
    if (value === undefined || value === null) continue;
    if (spec.shape === 'metrics') {
      const metrics = Array.isArray(value) ? value.filter(isMetricValue) : [];
      if (metrics.length)
        sections.push({ kind: 'metrics', key: spec.key, label: spec.label, metrics });
      continue;
    }
    const items =
      spec.shape === 'claim'
        ? [toItem(value, null, options.keepEmpty)]
        : Array.isArray(value)
          ? value.map((v, i) => toItem(v, i, options.keepEmpty))
          : [];
    const present = items.filter((i): i is RenderItem => i !== null);
    if (!present.length) continue;
    sections.push({
      kind: 'items',
      key: spec.key,
      label: narrative && spec.key === 'bullets' ? 'Narrative' : spec.label,
      shape: narrative && spec.key === 'bullets' ? 'claim' : spec.shape,
      items: present,
      cited: spec.shape !== 'plain',
    });
  }
  return { legacy: false, sections };
}

/** `prCount` → `Pr count`, `growth_and_learning` → `Growth and learning`. */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function legacyItem(raw: unknown, index: number): RenderItem | null {
  if (typeof raw === 'string' && raw.trim()) {
    return { ...EMPTY_ITEM, index, text: raw };
  }
  if (!isObject(raw)) return null;
  const text = str(raw.text) ?? str(raw.evidence) ?? str(raw.description) ?? str(raw.impact);
  const title = str(raw.title);
  if (!text && !title) return null;
  return {
    ...EMPTY_ITEM,
    index,
    title: text ? title : null,
    text: text ?? title ?? '',
    theme: str(raw.category),
  };
}

const EMPTY_ITEM: RenderItem = {
  id: null,
  index: null,
  title: null,
  text: '',
  citations: [],
  flags: [],
  theme: null,
  pinned: false,
  used: false,
};

/** Readable sections from a v0.1 document body (strings, lists, number tables). */
export function legacySections(raw: unknown): RenderSection[] {
  if (typeof raw === 'string' && raw.trim()) {
    return [
      {
        kind: 'items',
        key: 'text',
        label: 'Document',
        shape: 'claim',
        items: [{ ...EMPTY_ITEM, text: raw }],
        cited: false,
      },
    ];
  }
  if (!isObject(raw)) return [];
  const out: RenderSection[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const label = humanizeKey(key);
    if (typeof value === 'string' && value.trim()) {
      out.push({
        kind: 'items',
        key,
        label,
        shape: 'claim',
        items: [{ ...EMPTY_ITEM, text: value }],
        cited: false,
      });
    } else if (Array.isArray(value)) {
      const items = value.map(legacyItem).filter((i): i is RenderItem => i !== null);
      if (items.length) {
        out.push({ kind: 'items', key, label, shape: 'claims', items, cited: false });
      }
    } else if (isObject(value)) {
      const rows = Object.entries(value)
        .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && v.trim()))
        .map(([k, v]) => [humanizeKey(k), String(v)] as [string, string]);
      if (rows.length) out.push({ kind: 'table', key, label, rows });
    }
  }
  return out;
}

/** Display value of an engine metric (full precision on the wire, rounded only here). */
export function formatMetricValue(m: Pick<MetricValue, 'value' | 'unit' | 'status'>): string {
  if (m.status !== 'ok' || m.value === null) return 'Not enough data';
  switch (m.unit) {
    case 'ratio':
      return `${Math.round(m.value * 100)}%`;
    case 'hours':
      return `${m.value.toFixed(1)} h`;
    case 'days':
      return `${Math.round(m.value * 10) / 10} d`;
    case 'weeks':
      return `${Math.round(m.value * 10) / 10} wk`;
    default:
      return String(Math.round(m.value * 10) / 10);
  }
}

/** Counts flagged claims (uncited or invalid citation) in rendered sections. */
export function flaggedClaims(sections: RenderSection[]): number {
  let n = 0;
  for (const s of sections) {
    if (s.kind !== 'items') continue;
    for (const item of s.items) if (item.flags.length) n += 1;
  }
  return n;
}

/** Applies an edit to one item of stored content and returns the new content (immutable). */
export function updateContentItem(
  content: unknown,
  sectionKey: string,
  index: number | null,
  patch: Partial<Pick<RenderItem, 'text' | 'title' | 'pinned' | 'used'>>,
): unknown {
  if (!isObject(content)) return content;
  const hasSections = isObject(content.sections);
  const body = hasSections ? (content.sections as Record<string, unknown>) : content;
  const current = body[sectionKey];
  const apply = (item: unknown) => {
    if (!isObject(item)) return item;
    const { pinned: _pinned, used: _used, ...rest } = item;
    const next: Record<string, unknown> = { ...rest };
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.title !== undefined) next.title = patch.title;
    const pinned = patch.pinned ?? item.pinned === true;
    const used = patch.used ?? item.used === true;
    // `false` is stored as an absent flag (keeps content small and identical to model output).
    if (pinned) next.pinned = true;
    if (used) next.used = true;
    return next;
  };
  let value: unknown;
  if (index === null) value = apply(current);
  else if (Array.isArray(current)) {
    value = (current as unknown[]).map((it, i) => (i === index ? apply(it) : it));
  } else return content;
  const nextBody = { ...body, [sectionKey]: value };
  return hasSections ? { ...content, sections: nextBody } : nextBody;
}

/** Moves an item of an array section (`from` → `to`) and returns the new content. */
export function moveContentItem(
  content: unknown,
  sectionKey: string,
  from: number,
  to: number,
): unknown {
  if (!isObject(content)) return content;
  const hasSections = isObject(content.sections);
  const body = hasSections ? (content.sections as Record<string, unknown>) : content;
  const current = body[sectionKey];
  if (!Array.isArray(current) || from === to) return content;
  if (from < 0 || to < 0 || from >= current.length || to >= current.length) return content;
  const next: unknown[] = [...(current as unknown[])];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const nextBody = { ...body, [sectionKey]: next };
  return hasSections ? { ...content, sections: nextBody } : nextBody;
}
