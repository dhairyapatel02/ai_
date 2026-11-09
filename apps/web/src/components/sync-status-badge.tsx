'use client';

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

interface SyncStatusBadgeProps {
  status: 'syncing' | 'complete' | 'error' | 'idle';
}

export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  switch (status) {
    case 'syncing':
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Syncing
        </Badge>
      );
    case 'complete':
      return (
        <Badge variant="default" className="gap-1 bg-green-100 text-green-800">
          <CheckCircle2 className="h-3 w-3" />
          Synced
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Error
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          Idle
        </Badge>
      );
  }
}
