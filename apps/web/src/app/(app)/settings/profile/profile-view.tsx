'use client';

import {
  PeriodTypeWire,
  TimeZone,
  UpdateMeInput,
  UserDto,
  type MeDto,
  type PeriodTypeWire as PeriodType,
} from '@devimpact/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { ErrorState, PageHeader, PageSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { apiClient } from '@/lib/api/browser';
import { errorMessage } from '@/lib/api/errors';
import { useMe, useUpdateSettings } from '@/lib/api/hooks';
import { qk } from '@/lib/api/query-keys';

const PERIOD_LABELS: Record<PeriodType, string> = {
  month: 'Month',
  quarter: 'Quarter',
  half: 'Half',
  year: 'Year',
};

type FieldErrors = Partial<Record<'name' | 'timezone', string>>;

/** Interim Settings → Profile (P12 builds S20): name, time zone, default period. */
export function ProfileView() {
  const me = useMe();
  return (
    <div className="max-w-[760px]">
      <PageHeader title="Profile" lede="How DevImpact names you and shows dates and periods." />
      {me.isPending ? (
        <PageSkeleton kind="form" label="Loading your profile…" />
      ) : me.isError ? (
        <Card>
          <ErrorState error={me.error} what="your profile" onRetry={() => void me.refetch()} />
        </Card>
      ) : (
        <ProfileForm me={me.data} />
      )}
    </div>
  );
}

function ProfileForm({ me }: { me: MeDto }) {
  const queryClient = useQueryClient();
  const updateSettings = useUpdateSettings();
  const [name, setName] = useState(me.user.name);
  const [timezone, setTimezone] = useState(me.settings.timezone);
  const [period, setPeriod] = useState<PeriodType>(me.settings.defaultPeriodType);
  const [errors, setErrors] = useState<FieldErrors>({});
  const nameId = useId();
  const emailId = useId();
  const tzId = useId();

  const updateMe = useMutation({
    mutationFn: (input: UpdateMeInput) =>
      apiClient.patch('/me', { body: input, schema: z.object({ user: UserDto }) }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData<MeDto>(qk.me.detail(), (old) => (old ? { ...old, user } : old));
    },
  });

  const save = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!UpdateMeInput.safeParse({ name }).success) next.name = 'Enter a name (1–100 characters).';
    if (!TimeZone.safeParse(timezone).success)
      next.timezone = 'Use an IANA time zone, e.g. Europe/Berlin.';
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(next.name ? nameId : tzId)?.focus();
      return;
    }
    try {
      if (name.trim() !== me.user.name) await updateMe.mutateAsync({ name: name.trim() });
      if (timezone !== me.settings.timezone || period !== me.settings.defaultPeriodType) {
        await updateSettings.mutateAsync({ timezone, defaultPeriodType: period });
        // Periods and metrics depend on the time zone and default period.
        void queryClient.invalidateQueries({ queryKey: qk.metrics.all });
        void queryClient.invalidateQueries({ queryKey: qk.impact.all });
      }
      toast.success('Saved');
    } catch (error) {
      toast.error(errorMessage(error, 'your profile'));
    }
  };

  const saving = updateMe.isPending || updateSettings.isPending;
  return (
    <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Account</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              autoComplete="name"
              value={name}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            {errors.name ? (
              <p id={`${nameId}-error`} className="text-caption text-destructive">
                {errors.name}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="email"
              value={me.user.email}
              readOnly
              aria-describedby={`${emailId}-help`}
            />
            <p id={`${emailId}-help`} className="text-caption text-subtle-foreground">
              From your sign-in provider.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Dates and periods</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={tzId}>Time zone</Label>
            <Input
              id={tzId}
              value={timezone}
              className="max-w-xs"
              aria-invalid={errors.timezone ? true : undefined}
              aria-describedby={`${tzId}-help`}
              onChange={(e) => {
                setTimezone(e.target.value);
              }}
            />
            <p
              id={`${tzId}-help`}
              className={
                errors.timezone
                  ? 'text-caption text-destructive'
                  : 'text-caption text-subtle-foreground'
              }
            >
              {errors.timezone ??
                'Periods and business hours use this time zone. Changing it recomputes your metrics.'}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-medium" id="default-period-label">
              Default period
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={period}
              aria-labelledby="default-period-label"
              onValueChange={(v) => {
                const parsed = PeriodTypeWire.safeParse(v);
                if (parsed.success) setPeriod(parsed.data);
              }}
              className="self-start"
            >
              {PeriodTypeWire.options.map((p) => (
                <ToggleGroupItem key={p} value={p} aria-label={PERIOD_LABELS[p]}>
                  {PERIOD_LABELS[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-caption text-subtle-foreground">
              Overview pages open on this period containing today.
            </p>
          </div>
        </CardContent>
      </Card>
      <Button type="submit" loading={saving} className="self-start">
        Save changes
      </Button>
    </form>
  );
}
