'use client';

import { type MeDto } from '@devimpact/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingRow, SwitchRow } from '@/components/career/setting-row';
import { ConfirmDialog, ErrorState, PageHeader, PageSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDeleteAccount, useExportData } from '@/lib/api/career-hooks';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useMe, useRepos, useUpdateSettings } from '@/lib/api/hooks';
import { signOut } from '@/lib/sign-out';

/**
 * Settings → Privacy & data (S22, UJ-7): repositories counted (→ Integrations), redact private
 * repository names in AI output (F-76), export all data (`GET /me/export`, 3 a day — F-04) and
 * delete the account (alert dialog with the email typed to confirm — F-03; signed out after).
 */
export function PrivacyView() {
  const me = useMe();
  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="Privacy & data"
        lede="Your data is private to you. No manager or teammate can see it."
      />
      {me.isPending ? (
        <PageSkeleton kind="form" label="Loading your privacy settings…" />
      ) : me.isError ? (
        <div className="rounded-md border bg-card">
          <ErrorState error={me.error} what="your settings" onRetry={() => void me.refetch()} />
        </div>
      ) : (
        <PrivacyContent me={me.data} />
      )}
    </div>
  );
}

function PrivacyContent({ me }: { me: MeDto }) {
  const queryClient = useQueryClient();
  const connected = me.integrations.some((i) => i.status !== 'disconnected');
  const all = useRepos({ limit: 1 }, { enabled: connected });
  const included = useRepos({ limit: 1, included: true }, { enabled: connected });
  const update = useUpdateSettings();
  const [redact, setRedact] = useState(me.settings.aiRedactPrivateRepos);
  const exportData = useExportData();
  const [exported, setExported] = useState<string | null>(null);
  const del = useDeleteAccount();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const repoLine = !connected
    ? 'No GitHub connection yet.'
    : all.data?.meta.total !== undefined && included.data?.meta.total !== undefined
      ? `${included.data.meta.total} of ${all.data.meta.total} repositories are included.`
      : 'Choose which repositories count towards your KPIs and documents.';

  const exportError =
    exportData.isError && isApiError(exportData.error) && exportData.error.code === 'RATE_LIMITED'
      ? "You've exported 3 times today. Try again tomorrow."
      : exportData.isError
        ? errorMessage(exportData.error, 'your export')
        : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border bg-card" aria-label="Data used for insights">
        <SettingRow
          title="Repositories counted"
          description={repoLine}
          control={
            <Button variant="secondary" size="sm" asChild>
              <Link href="/settings/integrations">Manage</Link>
            </Button>
          }
        />
        <SwitchRow
          title="Redact private repository names in AI output"
          description={'Documents say "a private payments service" instead of the repository name.'}
          checked={redact}
          testId="toggle-redact"
          onChange={(v) => {
            setRedact(v);
            update.mutate(
              { aiRedactPrivateRepos: v },
              {
                onSuccess: () => toast.success('Saved'),
                onError: () => {
                  setRedact(!v);
                  toast.error("Couldn't save. Try again.");
                },
              },
            );
          }}
        />
      </section>

      <section
        className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:p-5"
        aria-labelledby="export-h"
      >
        <h2 id="export-h" className="font-semibold">
          Export your data
        </h2>
        <p className="text-sm text-muted-foreground">
          A JSON file with your profile, settings, imported activity, metrics, documents with
          versions, achievements and goals. GitHub tokens are never included.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            loading={exportData.isPending}
            disabled={exportData.isPending}
            onClick={() => {
              exportData.mutate(undefined, {
                onSuccess: (name) => {
                  setExported(name);
                  toast.success('Export downloaded');
                },
              });
            }}
          >
            {exportData.isPending ? null : <Download aria-hidden="true" />}
            {exportData.isPending ? 'Preparing…' : 'Export data'}
          </Button>
          {exported && !exportData.isPending ? (
            <span className="flex items-center gap-2 text-sm">
              <Badge variant="success">
                <CircleCheck aria-hidden="true" />
                Ready
              </Badge>
              <span className="font-mono text-caption">{exported}</span>
            </span>
          ) : null}
          <span className="text-caption text-subtle-foreground">Up to 3 exports a day</span>
        </div>
        {exportError ? (
          <p role="alert" className="text-sm text-destructive">
            {exportError}
          </p>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-card p-4 sm:p-5"
        aria-labelledby="delete-h"
      >
        <h2 id="delete-h" className="font-semibold">
          Delete account
        </h2>
        <p className="text-sm text-muted-foreground">
          Permanently deletes your account, imported activity, documents, achievements and goals,
          and revokes DevImpact&apos;s GitHub access. This can&apos;t be undone.
        </p>
        <Button
          variant="destructive-outline"
          size="sm"
          className="self-start"
          onClick={() => {
            del.reset();
            setDeleteOpen(true);
          }}
        >
          Delete account…
        </Button>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your account?"
        description="Everything is deleted immediately and can't be recovered. Export your data first if you might need it."
        confirmLabel="Delete account"
        destructive
        loading={del.isPending}
        typedConfirmation={me.user.email}
        onConfirm={() => {
          del.mutate(me.user.email, {
            onSuccess: () => {
              void signOut(queryClient, { reason: 'account_deleted' });
            },
          });
        }}
      >
        {del.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {isApiError(del.error) && del.error.code === 'VALIDATION_FAILED'
              ? "The email doesn't match your account"
              : errorMessage(del.error, 'your account')}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
