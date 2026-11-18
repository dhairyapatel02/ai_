'use client';

import { useId, useState } from 'react';

import { GenerateButton } from '@/components/generate-button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { periodPresets, usePeriod } from '@/lib/period';

import { StudioShell } from '../studio-shell';

const selectClass =
  'h-8 w-full max-w-xs rounded-sm border border-input bg-surface px-2 text-md md:text-base';

/** Interim appraisal studio on `POST /documents` (P11 builds S14). */
export function AppraisalStudio() {
  const period = usePeriod();
  const presets = period.today ? periodPresets(period.today) : [];
  const [spec, setSpec] = useState<string | null>(null);
  const [reflection, setReflection] = useState('');
  const periodId = useId();
  const reflectionId = useId();
  const chosen = spec ?? period.resolved?.spec ?? presets[0]?.spec ?? '';

  return (
    <StudioShell
      type="appraisal"
      title="New appraisal"
      lede="A self-review for a period, every claim linked to a pull request."
    >
      {({ generate, loading }) => (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={periodId}>Period</Label>
            <select
              id={periodId}
              className={selectClass}
              value={chosen}
              onChange={(e) => {
                setSpec(e.target.value);
              }}
            >
              {period.resolved && !presets.some((p) => p.spec === period.resolved?.spec) ? (
                <option value={period.resolved.spec}>{period.resolved.label}</option>
              ) : null}
              {presets.map((p) => (
                <option key={p.spec} value={p.spec}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={reflectionId}>Self-reflection (optional)</Label>
            <Textarea
              id={reflectionId}
              maxLength={4000}
              value={reflection}
              aria-describedby={`${reflectionId}-help`}
              onChange={(e) => {
                setReflection(e.target.value);
              }}
            />
            <p id={`${reflectionId}-help`} className="text-caption text-subtle-foreground">
              Context the evidence can&apos;t show, such as priorities or constraints.
            </p>
          </div>
          <GenerateButton
            loading={loading}
            disabledReason={chosen ? null : 'Choose a period first.'}
            onClick={() => {
              generate({
                type: 'appraisal',
                period: chosen,
                ...(reflection.trim() ? { selfReflection: reflection.trim() } : {}),
              });
            }}
          >
            Generate appraisal
          </GenerateButton>
        </>
      )}
    </StudioShell>
  );
}
