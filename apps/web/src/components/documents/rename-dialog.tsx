'use client';

import { CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateDocument } from '@/lib/api/document-hooks';
import { errorMessage, isApiError } from '@/lib/api/errors';

/** Rename a document (`PATCH /documents/:id { baseVersion, title }`, no new version). */
export function RenameDialog({
  open,
  onOpenChange,
  documentId,
  title,
  baseVersion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  title: string;
  baseVersion: number;
}) {
  const inputId = useId();
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateDocument(documentId);

  const save = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const next = value.trim();
    if (!next) {
      setError('Enter a title');
      return;
    }
    if (next.length > 200) {
      setError('Use 200 characters or fewer');
      return;
    }
    update.mutate(
      { baseVersion, title: next },
      {
        onSuccess: () => {
          toast.success('Renamed');
          onOpenChange(false);
        },
        onError: (e) => {
          setError(
            isApiError(e) && e.code === 'GENERATION_IN_PROGRESS'
              ? 'This document is still being written. Rename it when it is ready.'
              : isApiError(e) && e.code === 'VERSION_CONFLICT'
                ? 'A newer version exists. Reload the document and try again.'
                : errorMessage(e, 'the document'),
          );
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setValue(title);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>The title appears in Documents and on exports.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Title</Label>
            <Input
              id={inputId}
              value={value}
              maxLength={200}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-err` : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            {error ? (
              <span
                id={`${inputId}-err`}
                className="flex items-center gap-1 text-caption text-destructive"
              >
                <CircleAlert className="size-3.5" aria-hidden="true" />
                {error}
              </span>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save title
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
