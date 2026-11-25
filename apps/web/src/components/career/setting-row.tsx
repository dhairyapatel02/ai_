'use client';

import { useId, type ReactNode } from 'react';

import { Switch } from '@/components/ui/switch';

/** Settings row (S21/S22): title + description on the left, a control on the right. */
export function SettingRow({
  title,
  description,
  control,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}

/** A switch row whose label is the visible title (`role="switch"`, DESIGN_SYSTEM §10). */
export function SwitchRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  testId,
  children,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <SettingRow
      title={<label htmlFor={id}>{title}</label>}
      description={description ? <span id={`${id}-d`}>{description}</span> : undefined}
      control={
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? `${id}-d` : undefined}
          data-testid={testId}
          onCheckedChange={onChange}
        />
      }
    >
      {children}
    </SettingRow>
  );
}
