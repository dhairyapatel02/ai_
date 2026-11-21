'use client';

import {
  formatMetricValue,
  type PreviewEvidenceResponse,
  type StudioDocumentType,
} from '@devimpact/shared';
import { CircleAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DateRangePicker } from '@/components/date-range-picker';
import { NotConnectedState, useConnected } from '@/components/not-connected-state';
import { Banner, ErrorState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  useCreateDocument,
  useDebouncedValue,
  useDocumentDetail,
  usePreviewEvidence,
  useRegenerateDocument,
  useUsage,
} from '@/lib/api/document-hooks';
import { isApiError } from '@/lib/api/errors';
import { isBackfilling, useMe, useSyncStatus } from '@/lib/api/hooks';
import { generationErrorCopy, quotaCopy, STUDIO_TITLES } from '@/lib/documents';
import { plural } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import {
  defaultPeriod,
  formFromOptions,
  initialForm,
  LIMITS,
  periodOptions,
  previewOptions,
  ROLE_OPTIONS,
  toOptions,
  type StudioForm,
} from '@/lib/studio';
import { cn } from '@/lib/utils';

const CUSTOM = '__custom';

/**
 * Studios (S13 resume, S14 appraisal, S15 promotion): options, a debounced evidence preview
 * (`POST /documents/preview-evidence`, no AI), quota from `/me/usage`, Generate →
 * `POST /documents` (201 → viewer streaming; 200 cached → viewer "reused"). `?period=` pre-fills
 * the period (Overview links), `?from=<id>` duplicates a document's options and
 * `?regenerate=<id>` regenerates that document with changed options (FLOWS F6).
 */
export function StudioView({ type }: { type: StudioDocumentType }) {
  const connected = useConnected();
  const period = usePeriod();
  const me = useMe();
  if (!connected) {
    return (
      <>
        <PageHeader title={STUDIO_TITLES[type]} />
        <NotConnectedState
          title="Connect GitHub to write documents from your work"
          secondary={null}
        />
      </>
    );
  }
  if (!period.today || !period.timezone || !me.data) {
    return (
      <>
        <PageHeader title={STUDIO_TITLES[type]} />
        <StudioSkeleton />
      </>
    );
  }
  return (
    <StudioForm
      type={type}
      today={period.today}
      timezone={period.timezone}
      roles={{ current: me.data.settings.currentRole, target: me.data.settings.targetRole }}
      redacted={me.data.settings.aiRedactPrivateRepos}
    />
  );
}

function StudioSkeleton() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true">
      <Skeleton className="h-96 rounded-md" />
      <Skeleton className="h-72 rounded-md" />
      <span className="sr-only" role="status">
        Loading…
      </span>
    </div>
  );
}

function StudioForm({
  type,
  today,
  timezone,
  roles,
  redacted,
}: {
  type: StudioDocumentType;
  today: string;
  timezone: string;
  roles: { current: string | null; target: string | null };
  redacted: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const fromId = search.get('from') ?? search.get('regenerate');
  const regenerateId = search.get('regenerate');
  const source = useDocumentDetail(fromId);
  const urlPeriod = search.get('period');

  const [form, setForm] = useState<StudioForm>(() =>
    initialForm(defaultPeriod(type, today, timezone, urlPeriod), roles),
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const appliedSource = useRef<string | null>(null);

  // Pre-fill from a stored document once it loads (same type only).
  useEffect(() => {
    const doc = source.data?.document;
    if (!doc || appliedSource.current === doc.id || doc.type !== type) return;
    appliedSource.current = doc.id;
    setForm((f) => formFromOptions(f, doc.options));
  }, [source.data, type]);

  const options = useMemo(
    () => periodOptions(type, today, timezone, form.period),
    [type, today, timezone, form.period],
  );
  const preview = usePreviewEvidence(useDebouncedValue(previewOptions(type, form), 400));
  const usage = useUsage();
  const create = useCreateDocument();
  const regenerate = useRegenerateDocument(regenerateId ?? 'none');
  const sync = useSyncStatus();

  const gens = usage.data?.generations;
  const left = gens ? Math.max(0, gens.limit - gens.used) : null;
  const quotaError = isApiError(submitError) && submitError.code === 'QUOTA_EXCEEDED';
  const quotaFull = (gens ? gens.used >= gens.limit : false) || quotaError;
  const noEvidence = preview.data
    ? preview.data.counts.prsMerged +
        preview.data.counts.prsReviewed +
        preview.data.counts.commits ===
      0
    : false;
  const busy = create.isPending || regenerate.isPending;
  const disabledReason = quotaFull
    ? 'Monthly generations used up'
    : noEvidence
      ? 'Not enough evidence — choose a longer period'
      : null;

  const ids = {
    period: useId(),
    jd: useId(),
    notes: useId(),
    cur: useId(),
    tgt: useId(),
    ladder: useId(),
  };
  const set = <K extends keyof StudioForm>(key: K, value: StudioForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSubmitError(null);
  };

  const submit = () => {
    if (type === 'promotion') {
      const cur = form.currentRole.trim() ? null : 'Enter your current role';
      const tgt = form.targetRole.trim() ? null : "Enter the role you're aiming for";
      setCurrentError(cur);
      setTargetError(tgt);
      if (cur || tgt) {
        document.getElementById(cur ? ids.cur : ids.tgt)?.focus();
        return;
      }
    }
    const body = toOptions(type, form);
    if (!body) return;
    setSubmitError(null);
    if (regenerateId) {
      const { type: _t, ...changed } = body;
      regenerate.mutate(
        { options: changed },
        {
          onSuccess: () => {
            router.push(`/documents/${regenerateId}`);
          },
          onError: setSubmitError,
        },
      );
      return;
    }
    create.mutate(body, {
      onSuccess: (res) => {
        if (res.cached) {
          toast.info('Reused your last result — no generation used.');
        }
        router.push(`/documents/${res.document.id}`);
      },
      onError: setSubmitError,
    });
  };

  const counter = (value: string, max: number) => (
    <span className={cn('tabular-nums', value.length > max && 'text-destructive')}>
      {value.length.toLocaleString('en-US')} / {max.toLocaleString('en-US')}
    </span>
  );

  return (
    <>
      <PageHeader
        title={regenerateId ? 'Change options and regenerate' : STUDIO_TITLES[type]}
        lede={
          regenerateId
            ? 'A new version is written with these options. Earlier versions stay in history.'
            : undefined
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Options" className="rounded-md border bg-card">
          <div className="flex flex-col gap-5 p-4 md:p-5">
            {/* Period */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.period}>Period</Label>
              <select
                id={ids.period}
                className="h-9 w-full max-w-sm rounded-sm border border-input bg-surface px-2 text-md md:h-8 md:text-base"
                value={customOpen ? CUSTOM : form.period}
                onChange={(e) => {
                  if (e.target.value === CUSTOM) setCustomOpen(true);
                  else {
                    setCustomOpen(false);
                    set('period', e.target.value);
                  }
                }}
              >
                {options.map((o) => (
                  <option key={o.spec} value={o.spec}>
                    {o.label}
                  </option>
                ))}
                <option value={CUSTOM}>Custom range…</option>
              </select>
              {preview.data?.period.inProgress && type === 'appraisal' ? (
                <span className="text-caption text-subtle-foreground">
                  In-progress period: the draft covers work up to today.
                </span>
              ) : null}
              {customOpen ? (
                <DateRangePicker
                  className="mt-2 max-w-sm"
                  today={today}
                  applyLabel="Use this range"
                  onApply={(_range, spec) => {
                    setCustomOpen(false);
                    set('period', spec);
                  }}
                />
              ) : null}
            </div>

            {type === 'resume' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-base font-medium" id={`${ids.period}-role`}>
                    Role
                  </span>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={form.role}
                    aria-labelledby={`${ids.period}-role`}
                    className="flex-wrap"
                    onValueChange={(v) => {
                      const role = ROLE_OPTIONS.find((r) => r.value === v);
                      if (role) set('role', role.value);
                    }}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <ToggleGroupItem key={r.value} value={r.value}>
                        {r.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-base font-medium" id={`${ids.period}-format`}>
                      Format
                    </span>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={form.format}
                      aria-labelledby={`${ids.period}-format`}
                      onValueChange={(v) => {
                        if (v === 'bullets' || v === 'narrative') set('format', v);
                      }}
                    >
                      <ToggleGroupItem value="bullets">Bullets</ToggleGroupItem>
                      <ToggleGroupItem value="narrative">Narrative</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-base font-medium" id={`${ids.period}-length`}>
                      Length
                    </span>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={form.length}
                      aria-labelledby={`${ids.period}-length`}
                      onValueChange={(v) => {
                        if (v === 'short' || v === 'standard') set('length', v);
                      }}
                    >
                      <ToggleGroupItem value="short">Short</ToggleGroupItem>
                      <ToggleGroupItem value="standard">Standard</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={ids.jd}>
                    Job description{' '}
                    <span className="font-normal text-subtle-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id={ids.jd}
                    rows={5}
                    maxLength={LIMITS.jobDescription}
                    value={form.jobDescription}
                    placeholder="Paste a job posting to tailor the bullets to it"
                    aria-describedby={`${ids.jd}-help`}
                    onChange={(e) => {
                      set('jobDescription', e.target.value);
                    }}
                  />
                  <span
                    id={`${ids.jd}-help`}
                    className="flex justify-between gap-2 text-caption text-subtle-foreground"
                  >
                    <span>Never stored with your profile.</span>
                    {counter(form.jobDescription, LIMITS.jobDescription)}
                  </span>
                </div>
              </>
            ) : null}

            {type === 'appraisal' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.notes}>
                  Self-reflection notes{' '}
                  <span className="font-normal text-subtle-foreground">(optional)</span>
                </Label>
                <Textarea
                  id={ids.notes}
                  rows={5}
                  maxLength={LIMITS.selfReflection}
                  value={form.selfReflection}
                  placeholder="What are you proudest of? What would you do differently? Anything GitHub can't show?"
                  aria-describedby={`${ids.notes}-help`}
                  onChange={(e) => {
                    set('selfReflection', e.target.value);
                  }}
                />
                <span
                  id={`${ids.notes}-help`}
                  className="flex justify-between gap-2 text-caption text-subtle-foreground"
                >
                  <span>Used to shape the narrative.</span>
                  {counter(form.selfReflection, LIMITS.selfReflection)}
                </span>
              </div>
            ) : null}

            {type === 'promotion' ? (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <RoleField
                    id={ids.cur}
                    label="Current role"
                    value={form.currentRole}
                    error={currentError}
                    onChange={(v) => {
                      set('currentRole', v);
                      if (v.trim()) setCurrentError(null);
                    }}
                  />
                  <RoleField
                    id={ids.tgt}
                    label="Target role"
                    value={form.targetRole}
                    error={targetError}
                    onChange={(v) => {
                      set('targetRole', v);
                      if (v.trim()) setTargetError(null);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={ids.ladder}>
                    Career ladder or expectations{' '}
                    <span className="font-normal text-subtle-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id={ids.ladder}
                    rows={5}
                    maxLength={LIMITS.ladderText}
                    value={form.ladderText}
                    placeholder="Paste your company's expectations for the target level"
                    aria-describedby={`${ids.ladder}-help`}
                    onChange={(e) => {
                      set('ladderText', e.target.value);
                    }}
                  />
                  <span
                    id={`${ids.ladder}-help`}
                    className="flex justify-between gap-2 text-caption text-subtle-foreground"
                  >
                    <span>Sections are mapped to these expectations when provided.</span>
                    {counter(form.ladderText, LIMITS.ladderText)}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          {/* Footer: quota + Generate (sticky on phones) */}
          <div className="sticky bottom-[calc(var(--bottombar-height)+env(safe-area-inset-bottom))] flex flex-col gap-3 rounded-b-md border-t bg-card p-4 md:static md:flex-row md:items-center md:px-5">
            <div className="flex-1 text-caption" data-testid="studio-quota">
              {quotaFull && gens ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-warning">
                  <CircleAlert className="size-3.5" aria-hidden="true" />
                  {quotaCopy(gens.limit, gens.resetsAt)}
                  <Link
                    href="/settings/plan"
                    className="font-medium text-link underline-offset-2 hover:underline"
                  >
                    See plan
                  </Link>
                </span>
              ) : left !== null ? (
                <span className="text-subtle-foreground">
                  Uses 1 of {plural(left, 'generation')} left this month · same inputs reuse the
                  last result for free
                </span>
              ) : (
                <span className="text-subtle-foreground">
                  Uses 1 generation · same inputs reuse the last result for free
                </span>
              )}
            </div>
            <div className="flex flex-col items-stretch gap-1 md:items-end">
              <Button
                type="button"
                onClick={submit}
                loading={busy}
                disabled={disabledReason !== null}
                aria-describedby={disabledReason ? `${ids.period}-gen-reason` : undefined}
                className="md:min-w-32"
              >
                <Sparkles aria-hidden="true" />
                {regenerateId ? 'Regenerate' : 'Generate'}
              </Button>
              {disabledReason ? (
                <span id={`${ids.period}-gen-reason`} className="sr-only">
                  {disabledReason}
                </span>
              ) : null}
            </div>
          </div>
          {submitError && !quotaError ? (
            <div className="px-4 pb-4 md:px-5">
              <Banner tone="danger" role="alert" title="The draft couldn't be started">
                {generationErrorCopy(submitError)}
              </Banner>
            </div>
          ) : null}
        </section>

        <EvidencePreview
          type={type}
          preview={preview.data}
          loading={preview.isPending || (preview.isFetching && preview.isPlaceholderData)}
          error={preview.isError ? preview.error : null}
          onRetry={() => void preview.refetch()}
          importing={isBackfilling(sync.data)}
          redacted={redacted}
          noEvidence={noEvidence}
        />
      </div>
    </>
  );
}

function RoleField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        required
        maxLength={100}
        autoComplete="organization-title"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {error ? (
        <span id={`${id}-err`} className="flex items-center gap-1 text-caption text-destructive">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

function EvidencePreview({
  type,
  preview,
  loading,
  error,
  onRetry,
  importing,
  redacted,
  noEvidence,
}: {
  type: StudioDocumentType;
  preview: PreviewEvidenceResponse | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  importing: boolean;
  redacted: boolean;
  noEvidence: boolean;
}) {
  const headingId = useId();
  const counts = preview?.counts;
  const top = preview?.topEvidence.slice(0, 5) ?? [];
  const metrics = (preview?.metrics ?? []).filter((m) => m.status === 'ok').slice(0, 4);
  return (
    <aside
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      className="rounded-md border bg-card"
      data-testid="evidence-preview"
    >
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <h2 id={headingId} className="text-lg font-semibold">
          Evidence preview
        </h2>
        {preview ? (
          <span className="text-caption text-subtle-foreground">{preview.period.label}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 p-4">
        {error && !preview ? (
          <ErrorState
            error={error}
            what="the evidence preview"
            onRetry={onRetry}
            headingLevel={3}
            title="Couldn't load the evidence preview"
          />
        ) : !preview ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-sm" />
              ))}
            </div>
            <Skeleton className="h-28 rounded-sm" />
            <span className="sr-only" role="status">
              Loading the evidence preview…
            </span>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2">
              {(
                [
                  ['PRs merged', counts?.prsMerged ?? 0],
                  ['PRs reviewed', counts?.prsReviewed ?? 0],
                  ['Repositories', counts?.repos ?? 0],
                  ['Achievements', counts?.achievements ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col rounded-sm bg-surface-2 px-2.5 py-2">
                  <dt className="text-caption text-subtle-foreground">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {noEvidence ? (
              <Banner tone="warning" title="Not enough evidence" role="status">
                There&apos;s no merged or reviewed work in this period. Choose a longer period.
              </Banner>
            ) : null}
            {importing ? (
              <p className="text-caption text-subtle-foreground">
                Import in progress — older work may be missing.
              </p>
            ) : null}
            {top.length ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-base font-semibold">Most significant work</h3>
                <ul className="flex flex-col gap-2">
                  {top.map((item) => (
                    <li key={item.ref} className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-base">{item.title}</span>
                      <span className="truncate font-mono text-caption text-subtle-foreground">
                        {item.ref}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {type !== 'resume' && metrics.length ? (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-base font-semibold">Engine metrics</h3>
                <ul className="flex flex-col">
                  {metrics.map((m) => (
                    <li
                      key={m.key}
                      className="flex justify-between gap-2 border-b py-1 text-base last:border-0"
                    >
                      <span className="text-muted-foreground">{m.label}</span>
                      <span className="font-medium tabular-nums">{metricText(m)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-caption text-subtle-foreground">
              Ranked by DevImpact (size, labels, reviews), not by the AI.
              {redacted ? ' Private repository names are redacted from AI input.' : ''}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}

function metricText(m: PreviewEvidenceResponse['metrics'][number]) {
  return formatMetricValue(m);
}
