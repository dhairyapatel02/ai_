import { CONTENT_SCHEMAS, type DocumentTypeWire } from '@devimpact/shared';

/** Keys of engine-filled sections (KPI §8): never taken from the model or from user edits. */
const ENGINE_SECTIONS: Partial<Record<DocumentTypeWire, string>> = {
  appraisal: 'metrics',
  promotion: 'supportingData',
};

type Obj = Record<string, unknown>;
const sectionsOf = (content: unknown): Obj | null => {
  const c = content as { sections?: Obj } | null;
  return c && typeof c === 'object' && c.sections && typeof c.sections === 'object' ? c.sections : null;
};

/** Replace one section (single-section regenerate, F-47) in `previous` with `next`'s. */
export function mergeSection(type: DocumentTypeWire, previous: unknown, next: unknown, key: string): unknown {
  const prevSections = sectionsOf(previous);
  const nextSections = sectionsOf(next);
  if (prevSections && nextSections) {
    return { ...(previous as Obj), sections: { ...prevSections, [key]: nextSections[key] } };
  }
  if (type === 'resume' && previous && next && typeof previous === 'object') {
    return { ...(previous as Obj), [key]: (next as Obj)[key] };
  }
  return next;
}

/** Keep the engine-filled section of `base` (user edits cannot change computed numbers). */
export function preserveEngineSections(type: DocumentTypeWire, base: unknown, edited: unknown): unknown {
  const key = ENGINE_SECTIONS[type];
  const baseSections = sectionsOf(base);
  const editedSections = sectionsOf(edited);
  if (!key || !baseSections || !editedSections) return edited;
  return { ...(edited as Obj), sections: { ...editedSections, [key]: baseSections[key] } };
}

export function validateContent(type: DocumentTypeWire, content: unknown) {
  return CONTENT_SCHEMAS[type].safeParse(content);
}
