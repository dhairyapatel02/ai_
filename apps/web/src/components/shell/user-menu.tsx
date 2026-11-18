'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleGauge, Keyboard, LogOut, User } from 'lucide-react';
import Link from 'next/link';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/lib/api/hooks';
import { signOut } from '@/lib/sign-out';
import { cn } from '@/lib/utils';

import { useShell } from './shell-context';

export function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split('@')[0] || '?';
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` : source.slice(0, 2);
  return letters.toUpperCase();
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free plan',
  pro: 'Pro plan',
  team: 'Team plan',
  enterprise: 'Enterprise plan',
};

/** Account button (sidebar footer): Profile, Plan & usage, Keyboard shortcuts, Sign out. */
export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const { setShortcutsOpen } = useShell();
  const user = me.data?.user;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2',
          collapsed && 'justify-center px-0',
        )}
        aria-label={`Account menu${user ? ` for ${user.name}` : ''}`}
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-accent-foreground"
          aria-hidden="true"
        >
          {initials(user?.name, user?.email)}
        </span>
        {collapsed ? null : (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-base text-foreground">{user?.name ?? '…'}</span>
            <span className="truncate text-caption text-subtle-foreground">
              {user ? (PLAN_LABEL[user.plan] ?? user.plan) : ' '}
            </span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <User aria-hidden="true" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/plan">
            <CircleGauge aria-hidden="true" />
            Plan &amp; usage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setShortcutsOpen(true);
          }}
        >
          <Keyboard aria-hidden="true" />
          Keyboard shortcuts
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut(queryClient);
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
