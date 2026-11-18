'use client';

import { useId, useState } from 'react';

import { GenerateButton } from '@/components/generate-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { StudioShell } from '../studio-shell';

/** Interim promotion studio on `POST /documents` (last 12 months; P11 builds S15). */
export function PromotionStudio() {
  const [currentRole, setCurrentRole] = useState('Senior Engineer');
  const [targetRole, setTargetRole] = useState('Staff Engineer');
  const currentId = useId();
  const targetId = useId();
  const missing = !currentRole.trim() || !targetRole.trim();

  return (
    <StudioShell
      type="promotion"
      title="New promotion packet"
      lede="The case for your next level from the last 12 months, backed by pull requests and reviews."
    >
      {({ generate, loading }) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={currentId}>Current role</Label>
              <Input
                id={currentId}
                value={currentRole}
                maxLength={100}
                onChange={(e) => {
                  setCurrentRole(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={targetId}>Target role</Label>
              <Input
                id={targetId}
                value={targetRole}
                maxLength={100}
                onChange={(e) => {
                  setTargetRole(e.target.value);
                }}
              />
            </div>
          </div>
          <GenerateButton
            loading={loading}
            disabledReason={missing ? 'Enter your current and target roles.' : null}
            onClick={() => {
              generate({
                type: 'promotion',
                currentRole: currentRole.trim(),
                targetRole: targetRole.trim(),
              });
            }}
          >
            Generate promotion packet
          </GenerateButton>
        </>
      )}
    </StudioShell>
  );
}
