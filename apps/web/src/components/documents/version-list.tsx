'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { versionSourceLabel } from '@/lib/documents';
import { formatDate, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { DocumentVersionListItem } from '@devimpact/shared';
import type { z } from 'zod';

type Version = z.infer<typeof DocumentVersionListItem>;

/**
 * VersionList (DESIGN_SYSTEM §5.2): v N · source · date · View / Restore. The selected version
 * lives in the URL (`?version=`, IA §6); restoring writes a new `restore` version.
 */
export function VersionList({
  versions,
  current,
  selected,
  hrefFor,
  onRestore,
  restoring,
  disabledReason,
  loading,
}: {
  versions: Version[] | undefined;
  current: number;
  selected: number | null;
  hrefFor: (version: number | null) => string;
  onRestore: (version: number) => void;
  restoring: number | null;
  disabledReason: string | null;
  loading: boolean;
}) {
  if (loading && !versions) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-busy="true">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (!versions?.length) {
    return (
      <p className="p-4 text-base text-muted-foreground">
        Versions appear once the first draft is saved.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y" data-testid="version-list">
      {versions.map((v) => {
        const isCurrent = v.number === current;
        const isSelected = selected === v.number || (selected === null && isCurrent);
        return (
          <li
            key={v.number}
            className={cn('flex items-center gap-2 px-4 py-2.5', isSelected && 'bg-surface-2')}
            aria-current={isSelected ? 'true' : undefined}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-medium">
                v{v.number}
                {isCurrent ? ' · current' : ''}
              </span>
              <span className="text-caption text-subtle-foreground">
                {versionSourceLabel(v.source, v.number)} · {formatDate(v.createdAt)}{' '}
                {formatTime(v.createdAt)}
              </span>
            </div>
            {!isSelected ? (
              <Button size="sm" variant="ghost" asChild>
                <Link href={hrefFor(isCurrent ? null : v.number)} aria-label={`View v${v.number}`}>
                  View
                </Link>
              </Button>
            ) : null}
            {!isCurrent ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onRestore(v.number);
                }}
                loading={restoring === v.number}
                disabled={disabledReason !== null || (restoring !== null && restoring !== v.number)}
                title={disabledReason ?? undefined}
                aria-label={`Restore v${v.number}`}
              >
                Restore
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
