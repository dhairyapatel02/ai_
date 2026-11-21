import {
  PERIOD_SPEC_PATTERN,
  PeriodError,
  periodSpecContaining,
  resolvePeriod,
  shiftPeriodSpec,
  type DocumentOptions,
  type ResumeRole,
  type StudioDocumentType,
} from '@devimpact/shared';

/**
 * Studio options (S13–S15, API_CONTRACT_V2 §13.1): period presets, form state ⇄ `DocumentOptions`.
 * Pure helpers shared by the view and its tests.
 */

export interface PeriodOption {
  spec: string;
  label: string;
}

export const ROLE_OPTIONS: { value: ResumeRole; label: string }[] = [
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'fullstack', label: 'Fullstack' },
  { value: 'devops', label: 'DevOps' },
  { value: 'manager', label: 'Manager' },
];

export const LIMITS = { jobDescription: 8000, selfReflection: 4000, ladderText: 12000 } as const;

const DAY = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The last 12 months ending today (365 days, inside the 366-day custom limit). */
export function last12Months(today: string): string {
  return `custom:${addDays(today, -364)}..${today}`;
}

function label(spec: string, timezone: string, today: string): string | null {
  try {
    const p = resolvePeriod(spec, timezone, today);
    if (spec.startsWith('custom:') && spec === last12Months(today)) return 'Last 12 months';
    return p.inProgress && p.type !== 'custom' ? `${p.label} (in progress)` : p.label;
  } catch (error) {
    if (error instanceof PeriodError) return null;
    throw error;
  }
}

/** Period presets per studio; appraisal covers month/quarter/half/year (+ custom). */
export function periodOptions(
  type: StudioDocumentType,
  today: string,
  timezone: string,
  extra?: string | null,
): PeriodOption[] {
  const specs: string[] = [];
  if (type === 'appraisal') {
    for (const t of ['month', 'quarter', 'half', 'year'] as const) {
      const current = periodSpecContaining(t, today);
      specs.push(current, shiftPeriodSpec(current, -1));
    }
    specs.push(last12Months(today));
  } else {
    const half = periodSpecContaining('half', today);
    const year = periodSpecContaining('year', today);
    specs.push(
      last12Months(today),
      half,
      shiftPeriodSpec(half, -1),
      year,
      shiftPeriodSpec(year, -1),
    );
  }
  if (extra && !specs.includes(extra)) specs.unshift(extra);
  return specs.flatMap((spec) => {
    const l = label(spec, timezone, today);
    return l ? [{ spec, label: l }] : [];
  });
}

/** Default period: `?period=` when valid, else the half containing today (appraisal) or 12 months. */
export function defaultPeriod(
  type: StudioDocumentType,
  today: string,
  timezone: string,
  fromUrl: string | null,
): string {
  if (fromUrl && PERIOD_SPEC_PATTERN.test(fromUrl) && label(fromUrl, timezone, today)) {
    return fromUrl;
  }
  return type === 'appraisal' ? periodSpecContaining('half', today) : last12Months(today);
}

export interface StudioForm {
  period: string;
  role: ResumeRole;
  format: 'bullets' | 'narrative';
  length: 'short' | 'standard';
  jobDescription: string;
  selfReflection: string;
  currentRole: string;
  targetRole: string;
  ladderText: string;
}

export function initialForm(
  period: string,
  roles: { current?: string | null; target?: string | null },
) {
  return {
    period,
    role: 'backend',
    format: 'bullets',
    length: 'standard',
    jobDescription: '',
    selfReflection: '',
    currentRole: roles.current ?? '',
    targetRole: roles.target ?? '',
    ladderText: '',
  } satisfies StudioForm;
}

/** Form values from a stored document's options (Duplicate options / Change options). */
export function formFromOptions(base: StudioForm, options: unknown): StudioForm {
  if (!options || typeof options !== 'object') return base;
  const o = options as Record<string, unknown>;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  return {
    period:
      typeof o.period === 'string' && PERIOD_SPEC_PATTERN.test(o.period) ? o.period : base.period,
    role: ROLE_OPTIONS.some((r) => r.value === o.role) ? (o.role as ResumeRole) : base.role,
    format: o.format === 'narrative' ? 'narrative' : base.format,
    length: o.length === 'short' ? 'short' : base.length,
    jobDescription: text(o.jobDescription, base.jobDescription),
    selfReflection: text(o.selfReflection, base.selfReflection),
    currentRole: text(o.currentRole, base.currentRole),
    targetRole: text(o.targetRole, base.targetRole),
    ladderText: text(o.ladderText, base.ladderText),
  };
}

const optional = (v: string) => (v.trim() ? v.trim() : undefined);

/** `DocumentOptions` for the API (null while required fields are missing). */
export function toOptions(type: StudioDocumentType, f: StudioForm): DocumentOptions | null {
  switch (type) {
    case 'resume':
      return {
        type,
        period: f.period,
        role: f.role,
        format: f.format,
        length: f.length,
        ...(optional(f.jobDescription) ? { jobDescription: optional(f.jobDescription) } : {}),
      };
    case 'appraisal':
      return {
        type,
        period: f.period,
        ...(optional(f.selfReflection) ? { selfReflection: optional(f.selfReflection) } : {}),
      };
    case 'promotion':
      if (!f.currentRole.trim() || !f.targetRole.trim()) return null;
      return {
        type,
        period: f.period,
        currentRole: f.currentRole.trim(),
        targetRole: f.targetRole.trim(),
        ...(optional(f.ladderText) ? { ladderText: optional(f.ladderText) } : {}),
      };
  }
}

/** Preview options: everything that changes the evidence (period; roles for promotion). */
export function previewOptions(type: StudioDocumentType, f: StudioForm): DocumentOptions {
  if (type === 'promotion') {
    return {
      type,
      period: f.period,
      currentRole: f.currentRole.trim() || 'Engineer',
      targetRole: f.targetRole.trim() || 'Senior engineer',
    };
  }
  if (type === 'resume')
    return { type, period: f.period, role: f.role, format: 'bullets', length: 'standard' };
  return { type, period: f.period };
}
