'use client';

import { ResumeRole } from '@devimpact/shared';
import { useId, useState } from 'react';

import { DateRangePicker } from '@/components/date-range-picker';
import { GenerateButton } from '@/components/generate-button';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { usePeriod } from '@/lib/period';

import { StudioShell } from '../studio-shell';

const ROLE_LABELS: Record<string, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  fullstack: 'Full-stack',
  devops: 'DevOps',
  manager: 'Engineering manager',
};

const selectClass =
  'h-8 w-full max-w-xs rounded-sm border border-input bg-surface px-2 text-md md:text-base';

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Interim resume studio on `POST /documents` (P11 builds S13). */
export function ResumeStudio() {
  const period = usePeriod();
  const today = period.today;
  const [role, setRole] = useState<ResumeRole>('fullstack');
  const [format, setFormat] = useState<'bullets' | 'narrative'>('bullets');
  const [range, setRange] = useState<{ spec: string; label: string } | null>(null);
  const roleId = useId();

  return (
    <StudioShell
      type="resume"
      title="New resume bullets"
      lede="Concise bullets from your engineering activity, every claim linked to evidence."
    >
      {({ generate, loading }) => (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleId}>Role</Label>
            <select
              id={roleId}
              className={selectClass}
              value={role}
              onChange={(e) => {
                const parsed = ResumeRole.safeParse(e.target.value);
                if (parsed.success) setRole(parsed.data);
              }}
            >
              {ResumeRole.options.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium" id="resume-format-label">
              Format
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={format}
              aria-labelledby="resume-format-label"
              className="self-start"
              onValueChange={(v) => {
                if (v === 'bullets' || v === 'narrative') setFormat(v);
              }}
            >
              <ToggleGroupItem value="bullets">Bullets</ToggleGroupItem>
              <ToggleGroupItem value="narrative">Narrative</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {today ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-base font-medium">Period</legend>
              <DateRangePicker
                today={today}
                value={{ from: monthsBefore(today, 6), to: today }}
                applyLabel="Use this range"
                onApply={(r, spec) => {
                  setRange({ spec, label: `${r.from} – ${r.to}` });
                }}
              />
              <p className="text-caption text-subtle-foreground" aria-live="polite">
                {range ? `Using ${range.label}.` : 'Defaults to the last 6 months.'}
              </p>
            </fieldset>
          ) : null}
          <GenerateButton
            loading={loading}
            disabledReason={today ? null : 'Loading your settings…'}
            onClick={() => {
              if (!today) return;
              generate({
                type: 'resume',
                role,
                format,
                length: 'standard',
                period: range?.spec ?? `custom:${monthsBefore(today, 6)}..${today}`,
              });
            }}
          >
            Generate resume bullets
          </GenerateButton>
        </>
      )}
    </StudioShell>
  );
}
