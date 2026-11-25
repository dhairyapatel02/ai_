'use client';

import {
  PeriodTypeWire,
  TimeZone,
  UpdateMeInput,
  UserDto,
  type MeDto,
  type PeriodTypeWire as PeriodType,
} from '@devimpact/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { ErrorState, PageHeader, PageSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { apiClient } from '@/lib/api/browser';
import { errorMessage } from '@/lib/api/errors';
import { useMe, useUpdateSettings } from '@/lib/api/hooks';
import { qk } from '@/lib/api/query-keys';
import { authClient } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';

const PERIOD_LABELS: Record<PeriodType, string> = {
  month: 'Month',
  quarter: 'Quarter',
  half: 'Half',
  year: 'Year',
};

type FieldErrors = Partial<Record<'name' | 'timezone' | 'roles', string>>;
interface Providers {
  github: boolean;
  google: boolean;
}

/**
 * Settings → Profile (S20, F-05): display name, email (read-only), time zone (IANA, recompute
 * toast), current role, level, target role, default period; sign-in methods (link Google) and
 * sessions (sign out other devices) through Better Auth.
 */
export function ProfileView({ providers }: { providers: Providers }) {
  const me = useMe();
  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="Profile"
        lede="Used to personalise documents and to compute every metric in your time zone."
      />
      {me.isPending ? (
        <PageSkeleton kind="form" label="Loading your profile…" />
      ) : me.isError ? (
        <Card>
          <ErrorState error={me.error} what="your profile" onRetry={() => void me.refetch()} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <ProfileForm me={me.data} />
          <SignInMethods providers={providers} />
          <Sessions />
        </div>
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
  const [role, setRole] = useState(me.settings.currentRole ?? '');
  const [level, setLevel] = useState(me.settings.careerLevel ?? '');
  const [target, setTarget] = useState(me.settings.targetRole ?? '');
  const roleId = useId();
  const levelId = useId();
  const targetId = useId();
  const dirty =
    name.trim() !== me.user.name ||
    timezone !== me.settings.timezone ||
    period !== me.settings.defaultPeriodType ||
    role.trim() !== (me.settings.currentRole ?? '') ||
    level.trim() !== (me.settings.careerLevel ?? '') ||
    target.trim() !== (me.settings.targetRole ?? '');
  useUnsavedChangesWarning(dirty);
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
    if ([role, level, target].some((v) => v.trim().length > 100))
      next.roles = 'Use 100 characters or fewer.';
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(next.name ? nameId : tzId)?.focus();
      return;
    }
    try {
      if (name.trim() !== me.user.name) await updateMe.mutateAsync({ name: name.trim() });
      const roles = {
        currentRole: role.trim() || null,
        careerLevel: level.trim() || null,
        targetRole: target.trim() || null,
      };
      const rolesChanged =
        roles.currentRole !== me.settings.currentRole ||
        roles.careerLevel !== me.settings.careerLevel ||
        roles.targetRole !== me.settings.targetRole;
      const tzChanged = timezone !== me.settings.timezone;
      if (tzChanged || period !== me.settings.defaultPeriodType || rolesChanged) {
        await updateSettings.mutateAsync({ timezone, defaultPeriodType: period, ...roles });
        // Periods and metrics depend on the time zone and default period.
        void queryClient.invalidateQueries({ queryKey: qk.metrics.all });
        void queryClient.invalidateQueries({ queryKey: qk.impact.all });
      }
      toast.success('Profile saved');
      if (tzChanged) toast.info(`Recalculating your KPIs in ${timezone}…`);
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
            <h2>Role, dates and periods</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id={roleId}
              label="Current role"
              value={role}
              onChange={setRole}
              placeholder="e.g. Backend engineer"
            />
            <TextField
              id={levelId}
              label="Level"
              optional
              value={level}
              onChange={setLevel}
              placeholder="e.g. Senior (L5)"
            />
          </div>
          <TextField
            id={targetId}
            label="Target role"
            optional
            value={target}
            onChange={setTarget}
            placeholder="e.g. Staff engineer"
            help="Pre-fills promotion packets."
          />
          {errors.roles ? <p className="text-caption text-destructive">{errors.roles}</p> : null}
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
                'Changing it recalculates all KPIs and scores. Periods and business hours follow this time zone.'}
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

function TextField({
  id,
  label,
  value,
  onChange,
  optional = false,
  placeholder,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  placeholder?: string;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-subtle-foreground"> (optional)</span> : null}
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={100}
        placeholder={placeholder}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {help ? (
        <p id={`${id}-help`} className="text-caption text-subtle-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** S20 Partial: "You have unsaved changes" when leaving with edits (browser prompt). */
function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);
}

const PROVIDER_LABEL: Record<string, string> = { github: 'GitHub', google: 'Google' };

/** Sign-in identities (Better Auth `listAccounts`, `linkSocial`). */
function SignInMethods({ providers }: { providers: Providers }) {
  const accounts = useQuery({
    queryKey: ['sessions', 'accounts'],
    queryFn: async () => {
      const res = await authClient.listAccounts();
      if (res.error) throw new Error(res.error.message ?? 'Could not load sign-in methods');
      return res.data.map((a) => ({ id: a.id, providerId: a.providerId }));
    },
  });
  const linked = new Set(accounts.data?.map((a) => a.providerId));
  const link = useMutation({
    mutationFn: async (provider: 'google' | 'github') => {
      const res = await authClient.linkSocial({ provider, callbackURL: '/settings/profile' });
      if (res.error) throw new Error(res.error.message ?? 'Could not link the account');
    },
    onError: () => toast.error("Couldn't start linking. Try again."),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Sign-in methods</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : accounts.isError ? (
          <p className="text-sm text-destructive">Couldn&apos;t load your sign-in methods.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {(['github', 'google'] as const)
              .filter((p) => linked.has(p) || providers[p])
              .map((p) => (
                <li key={p} className="flex items-center gap-3 py-2.5">
                  <span className="flex-1">{PROVIDER_LABEL[p]}</span>
                  {linked.has(p) ? (
                    <Badge variant="neutral">Linked</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={link.isPending}
                      onClick={() => {
                        link.mutate(p);
                      }}
                    >
                      Link {PROVIDER_LABEL[p]}
                    </Button>
                  )}
                </li>
              ))}
            {[...linked].filter((p) => !(p in PROVIDER_LABEL)).length > 0 ? (
              <li className="py-2.5 text-sm text-muted-foreground">Development sign-in</li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Active sessions (Better Auth `listSessions`, `revokeSession`). */
function Sessions() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: qk.sessions.list(),
    queryFn: async () => {
      const [list, current] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
      ]);
      if (list.error) throw new Error(list.error.message ?? 'Could not load sessions');
      const currentId = current.data?.session.id;
      return list.data.map((s) => ({
        id: s.id,
        token: s.token,
        userAgent: s.userAgent ?? null,
        updatedAt: new Date(s.updatedAt).toISOString(),
        current: s.id === currentId,
      }));
    },
  });
  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const res = await authClient.revokeSession({ token });
      if (res.error) throw new Error(res.error.message ?? 'Could not sign out');
    },
    onSuccess: () => {
      toast.success('Signed out of that device');
      void queryClient.invalidateQueries({ queryKey: qk.sessions.all });
    },
    onError: () => toast.error("Couldn't sign out that session. Try again."),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Sessions</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : sessions.isError ? (
          <p className="text-sm text-destructive">Couldn&apos;t load your sessions.</p>
        ) : (
          <ul className="flex flex-col divide-y" data-testid="session-list">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{describeAgent(s.userAgent)}</span>
                  <span className="text-caption text-subtle-foreground">
                    {s.current
                      ? 'This device'
                      : `Last active ${formatDate(s.updatedAt, { withYear: true })}`}
                  </span>
                </span>
                {s.current ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={revoke.isPending && revoke.variables === s.token}
                    onClick={() => {
                      revoke.mutate(s.token);
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** "Chrome on macOS" from a user agent (best effort; unknown agents say "Browser"). */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Browser';
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Firefox/')
      ? 'Firefox'
      : ua.includes('Chrome/')
        ? 'Chrome'
        : ua.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : ua.includes('Android')
      ? 'Android'
      : ua.includes('Mac OS X')
        ? 'macOS'
        : ua.includes('Windows')
          ? 'Windows'
          : ua.includes('Linux')
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}
