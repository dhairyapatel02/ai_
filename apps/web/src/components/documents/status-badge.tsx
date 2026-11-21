import { LoaderCircle, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS } from '@/lib/documents';

import type { DocumentStatusWire } from '@devimpact/shared';

/** Library / header status badge (S11): Queued, Writing (spinner), Ready, Failed, Cancelled. */
export function StatusBadge({ status }: { status: DocumentStatusWire }) {
  if (status === 'streaming') {
    return (
      <Badge variant="accent">
        <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {STATUS_LABELS.streaming}
      </Badge>
    );
  }
  if (status === 'pending') return <Badge variant="accent">{STATUS_LABELS.pending}</Badge>;
  if (status === 'failed') return <Badge variant="danger">{STATUS_LABELS.failed}</Badge>;
  if (status === 'cancelled') return <Badge variant="neutral">{STATUS_LABELS.cancelled}</Badge>;
  return <Badge variant="neutral">{STATUS_LABELS.ready}</Badge>;
}

/** "2 uncited" (A-5 flags) — claims without valid evidence. */
export function UncitedBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="warning">
      <TriangleAlert aria-hidden="true" />
      {count} uncited
    </Badge>
  );
}
