import {
  PeriodError,
  localDateOf,
  resolvePeriod,
  type DocumentStatusWire,
  type DocumentSummary,
  type DocumentTypeWire,
  type ResolvedPeriod,
  type VersionSourceWire,
} from '@devimpact/shared';
import { DocumentType, type GeneratedDocument, type VersionSource } from '@prisma/client';

export const toTypeWire = (t: DocumentType) => t.toLowerCase() as DocumentTypeWire;
export const toTypeEnum = (t: DocumentTypeWire) => t.toUpperCase() as DocumentType;
export const toSourceWire = (s: VersionSource) => s.toLowerCase() as VersionSourceWire;

export const isLegacy = (doc: Pick<GeneratedDocument, 'promptId'>) => doc.promptId === 'legacy';

/** The period as it was resolved when the document was generated (null for legacy/items). */
export function storedPeriod(doc: GeneratedDocument): ResolvedPeriod | null {
  const options = doc.options as { period?: unknown } | null;
  const spec = typeof options?.period === 'string' ? options.period : null;
  if (!spec || !doc.timezone) return null;
  try {
    return resolvePeriod(spec, doc.timezone, localDateOf(doc.createdAt, doc.timezone));
  } catch (error) {
    if (error instanceof PeriodError) return null;
    throw error;
  }
}

export function toSummary(doc: GeneratedDocument): DocumentSummary {
  const ready = doc.status === 'READY';
  return {
    id: doc.id,
    type: toTypeWire(doc.type),
    title: doc.title,
    status: doc.status.toLowerCase() as DocumentStatusWire,
    currentVersion: doc.currentVersion,
    period: storedPeriod(doc),
    model: doc.model,
    citationCoverage: doc.citationCoverage,
    flags:
      ready && doc.flagsUncited !== null && doc.flagsInvalid !== null
        ? { uncited: doc.flagsUncited, invalid: doc.flagsInvalid }
        : null,
    errorCode: doc.errorCode,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export const streamUrl = (id: string) => `/api/documents/${id}/stream`;
