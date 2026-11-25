'use client';

import { type SettingsDto, type UpdateSettingsInput } from '@devimpact/shared';
import { Eye } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { SwitchRow } from '@/components/career/setting-row';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDigestPreview } from '@/lib/api/career-hooks';
import { errorMessage } from '@/lib/api/errors';
import { useMe, useUpdateSettings } from '@/lib/api/hooks';

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Settings → Notifications (S21, F-63/F-65): toggles save immediately ("Saved"); a failed save
 * reverts the toggle with "Couldn't save. Try again."; digest off hides the schedule; "Preview
 * this week's digest" renders `POST /notifications/digest/preview` (nothing is sent).
 */
export function NotificationsView() {
  const me = useMe();
  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="Notifications"
        lede={
          me.data
            ? `Emails go to ${me.data.user.email}. Every email has a one-click unsubscribe link.`
            : 'Every email has a one-click unsubscribe link.'
        }
      />
      {me.isPending ? (
        <PageSkeleton kind="form" label="Loading your notification settings…" />
      ) : me.isError ? (
        <div className="rounded-md border bg-card">
          <ErrorState error={me.error} what="your settings" onRetry={() => void me.refetch()} />
        </div>
      ) : (
        <NotificationsForm settings={me.data.settings} />
      )}
    </div>
  );
}

function NotificationsForm({ settings }: { settings: SettingsDto }) {
  const update = useUpdateSettings();
  // Optimistic local copy so a toggle flips at once and reverts on failure.
  const [local, setLocal] = useState(settings);
  const [previewOpen, setPreviewOpen] = useState(false);
  const dayId = useId();
  const hourId = useId();

  const patch = (input: UpdateSettingsInput) => {
    const before = local;
    setLocal((s) => ({ ...s, ...input }));
    update.mutate(input, {
      onSuccess: (saved) => {
        setLocal(saved);
        toast.success('Saved');
      },
      onError: () => {
        setLocal(before);
        toast.error("Couldn't save. Try again.");
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border bg-card" aria-label="Email notifications">
        <SwitchRow
          title="Weekly digest"
          description="What you shipped and reviewed last week, plus suggested achievements."
          checked={local.digestEnabled}
          testId="toggle-digest"
          onChange={(v) => {
            patch({ digestEnabled: v });
          }}
        >
          {local.digestEnabled ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={dayId}>Send on</Label>
                  <Select
                    value={String(local.digestDayOfWeek)}
                    onValueChange={(v) => {
                      patch({ digestDayOfWeek: Number(v) });
                    }}
                  >
                    <SelectTrigger id={dayId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d, i) => (
                        <SelectItem key={d} value={String(i + 1)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={hourId}>At</Label>
                  <Select
                    value={String(local.digestHourLocal)}
                    onValueChange={(v) => {
                      patch({ digestHourLocal: Number(v) });
                    }}
                  >
                    <SelectTrigger id={hourId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {String(h).padStart(2, '0')}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Times in {local.timezone}.</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPreviewOpen(true);
                  }}
                >
                  <Eye aria-hidden="true" />
                  Preview this week&apos;s digest
                </Button>
              </div>
            </div>
          ) : null}
        </SwitchRow>
        <SwitchRow
          title="Sync problems"
          description="When GitHub needs reconnecting or a sync keeps failing."
          checked={local.notifySyncFailures}
          testId="toggle-sync"
          onChange={(v) => {
            patch({ notifySyncFailures: v });
          }}
        />
        <SwitchRow
          title="Document ready"
          description="When a long document finishes generating after you leave the page."
          checked={local.notifyDocumentReady}
          testId="toggle-document"
          onChange={(v) => {
            patch({ notifyDocumentReady: v });
          }}
        />
      </section>
      <DigestPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}

/** Renders the preview's HTML in a sandboxed iframe (no scripts, no same-origin access). */
function DigestPreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const preview = useDigestPreview();
  const { mutate } = preview;
  useEffect(() => {
    if (open) mutate();
  }, [open, mutate]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>Preview · not sent</DialogDescription>
          <DialogTitle>{preview.data?.subject ?? 'Your weekly digest'}</DialogTitle>
        </DialogHeader>
        {preview.isPending || (!preview.data && !preview.isError) ? (
          <p className="text-sm text-muted-foreground" role="status">
            Preparing the preview…
          </p>
        ) : preview.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage(preview.error, 'the preview')}
          </p>
        ) : (
          <iframe
            title="Digest preview"
            sandbox=""
            srcDoc={preview.data.html}
            className="h-[60dvh] w-full rounded-md border"
            style={{ background: '#ffffff' }}
            data-testid="digest-preview"
          />
        )}
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
