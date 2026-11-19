'use client';

import { Plug } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/api/hooks';

/** `true` while `/me` loads (no flash of the empty state), else whether GitHub is connected. */
export function useConnected(): boolean {
  const me = useMe();
  return me.data ? me.data.integrations.some((i) => i.status !== 'disconnected') : true;
}

/** Empty — no integration (DESIGN_SYSTEM §9): Connect GitHub, never zero-filled data. */
export function NotConnectedState({
  title = 'Connect GitHub to see your impact',
  secondary = { href: '/kpis', label: 'How metrics work' },
}: {
  title?: string;
  secondary?: { href: string; label: string } | null;
}) {
  return (
    <div className="rounded-md border bg-card" data-testid="not-connected">
      <EmptyState
        icon={Plug}
        title={title}
        description="DevImpact reads your pull requests, reviews and commits (read-only) and turns them into KPIs you can explain. It takes about 3 minutes."
        actions={
          <>
            <Button asChild>
              <Link href="/onboarding/connect">Connect GitHub</Link>
            </Button>
            {secondary ? (
              <Button variant="secondary" asChild>
                <Link href={secondary.href}>{secondary.label}</Link>
              </Button>
            ) : null}
          </>
        }
      />
    </div>
  );
}
