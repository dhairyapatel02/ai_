'use client';

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { ReactNode } from 'react';

/**
 * Primary AI action (DESIGN_SYSTEM §7: `sparkles` only on buttons that call Claude). While
 * generating, the label stays legible ("Generating…"), the button is `aria-busy`, and an optional
 * progress line ("Writing section 2 of 5 · Key accomplishments") is announced politely. A disabled
 * button always shows its reason (quota, rate limit).
 */
export function GenerateButton({
  loading,
  onClick,
  children = 'Generate',
  progress,
  disabledReason,
}: {
  loading: boolean;
  onClick: () => void;
  children?: ReactNode;
  progress?: string | null;
  disabledReason?: string | null;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button size="lg" loading={loading} disabled={Boolean(disabledReason)} onClick={onClick}>
        <Sparkles aria-hidden="true" />
        {loading ? 'Generating…' : children}
      </Button>
      <p className="min-h-4 text-caption text-subtle-foreground" aria-live="polite">
        {disabledReason ?? (loading ? (progress ?? 'Gathering your evidence…') : '')}
      </p>
    </div>
  );
}
