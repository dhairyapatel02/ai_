import {
  DOCUMENT_TYPE_LABELS,
  type DocumentSummary,
  type DocumentTypeWire,
} from '@devimpact/shared';

import { isApiError, quotaDetails, type ApiError } from '@/lib/api/errors';

/**
 * Copy and small helpers for the document studio (SCREENS S11–S16, DESIGN_SYSTEM §8). Shared by
 * Server and Client Components, so nothing here is a client module.
 */

export const STUDIO_TITLES = {
  resume: 'New resume bullets',
  appraisal: 'New appraisal',
  promotion: 'New promotion packet',
} as const;

export function typeLabel(type: DocumentTypeWire): string {
  return DOCUMENT_TYPE_LABELS[type];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-12-01T00:00:00Z` → "December 1" (quota resets are UTC month starts). */
export function resetDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`;
}

/** The month a reset ends ("November" for a December 1 reset). */
function usageMonth(iso: string): string {
  const d = new Date(iso);
  return MONTHS[(d.getUTCMonth() + 11) % 12] ?? '';
}

/** "You've used all 15 generations for November. They reset on December 1." */
export function quotaCopy(limit: number, resetsAt: string): string {
  return `You've used all ${limit} generations for ${usageMonth(resetsAt)}. They reset on ${resetDate(resetsAt)}.`;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Studio / regenerate errors (S13–S15 Error row, F6). `null` → handled elsewhere. */
export function generationErrorCopy(error: unknown): string {
  if (!isApiError(error)) return "The draft couldn't be started. Try again in a minute.";
  switch (error.code) {
    case 'QUOTA_EXCEEDED': {
      const q = quotaDetails(error);
      return q ? quotaCopy(q.limit, q.resetsAt) : "You've used this month's generations.";
    }
    case 'RATE_LIMITED': {
      const seconds = error.retryAfterSeconds ?? 60;
      return `Too many generations in a short time. Try again at ${hhmm(new Date(Date.now() + seconds * 1000))}.`;
    }
    case 'CONFLICT':
      return (error.details as { reason?: string } | null)?.reason === 'no_evidence'
        ? "There's no merged or reviewed work in this period. Choose a longer period."
        : "This document can't be regenerated.";
    case 'GENERATION_IN_PROGRESS':
      return 'This document is still being written.';
    case 'UPSTREAM_UNAVAILABLE':
      return (error.details as { reason?: string } | null)?.reason === 'not_configured'
        ? "AI generation isn't configured on this server."
        : 'The AI service is busy. Try again in a minute — nothing was counted against your quota.';
    case 'INVALID_PERIOD':
      return "That period isn't valid. Choose 7–366 days that don't start in the future.";
    case 'VALIDATION_FAILED':
      return 'Check the highlighted fields.';
    case 'NETWORK_ERROR':
      return "The DevImpact API didn't respond. Try again.";
    default:
      return "The draft couldn't be started. Try again in a minute.";
  }
}

/** Terminal SSE `error` copy (S16 Error): calm, says nothing was counted. */
export function streamErrorCopy(code: string): string {
  switch (code) {
    case 'UPSTREAM_UNAVAILABLE':
      return 'The AI service was overloaded. Nothing was counted against your quota.';
    case 'OUTPUT_INVALID':
      return "The AI's draft didn't pass our checks. Nothing was counted against your quota.";
    default:
      return 'Something went wrong while writing. Nothing was counted against your quota.';
  }
}

export function coverageLabel(coverage: number | null | undefined): string | null {
  return coverage == null ? null : `${Math.round(coverage * 100)}% of claims cited`;
}

/** "Appraisal ready — 96% of claims cited." */
export function readyToastText(doc: Pick<DocumentSummary, 'type' | 'citationCoverage'>): string {
  const coverage = coverageLabel(doc.citationCoverage);
  return `${typeLabel(doc.type)} ready${coverage ? ` — ${coverage}` : ''}.`;
}

export function isQuotaError(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'QUOTA_EXCEEDED';
}

export const STATUS_LABELS = {
  pending: 'Queued',
  streaming: 'Writing',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;

/** Version source labels (VersionList, S16). */
export function versionSourceLabel(source: 'ai' | 'user_edit' | 'restore', number: number): string {
  if (source === 'user_edit') return 'Your edits';
  if (source === 'restore') return 'Restored';
  return number === 1 ? 'Generated' : 'Regenerated';
}
