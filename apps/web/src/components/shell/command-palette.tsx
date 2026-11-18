'use client';

import { DocumentSummary } from '@devimpact/shared';
import { useQuery } from '@tanstack/react-query';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Award,
  Calendar,
  File,
  FileText,
  Gauge,
  Keyboard,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Search,
  SunMoon,
  Target,
  TrendingUp,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useDeferredValue, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { apiClient } from '@/lib/api/browser';
import { errorMessage } from '@/lib/api/errors';
import { isSyncActive, useStartSync, useSyncStatus } from '@/lib/api/hooks';
import { qk } from '@/lib/api/query-keys';
import { cn } from '@/lib/utils';

import { NAV_GROUPS, PERIOD_PATHS } from './nav-config';
import { useShell } from './shell-context';
import { nextTheme } from './theme-toggle';

function Item({
  value,
  icon,
  children,
  hint,
  disabled,
  onSelect,
}: {
  value: string;
  icon: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      disabled={disabled}
      onSelect={onSelect}
      className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-base text-foreground select-none data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-subtle-foreground data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-caption text-subtle-foreground">{hint}</span> : null}
    </CommandPrimitive.Item>
  );
}

const groupClass =
  'px-1 pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle-foreground';

/**
 * ⌘K command palette (IA §5, SCREENS O1): Go to · Actions · Documents (5 most recent, then server
 * search from 2 characters) · Help. Disabled actions show their reason instead of disappearing.
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const shell = useShell();
  const sync = useSyncStatus();
  const startSync = useStartSync();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const searching = query.length >= 2;

  const documents = useQuery({
    queryKey: qk.documents.list(
      searching ? { q: query, limit: 8 } : { sort: '-updatedAt', limit: 5 },
    ),
    queryFn: ({ signal }) =>
      apiClient.getPage('/documents', {
        schema: DocumentSummary,
        query: searching ? { q: query, limit: 8 } : { sort: '-updatedAt', limit: 5 },
        signal,
      }),
    enabled: shell.paletteOpen,
    staleTime: 30_000,
  });

  const close = () => {
    shell.setPaletteOpen(false);
    setSearch('');
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const syncReason =
    sync.data === null
      ? 'Connect GitHub first'
      : isSyncActive(sync.data)
        ? 'A sync is already running'
        : sync.data?.state === 'needs_reauth'
          ? 'Reconnect GitHub first'
          : undefined;

  return (
    <Dialog
      open={shell.paletteOpen}
      onOpenChange={(open) => {
        if (!open) close();
        else shell.setPaletteOpen(true);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-4 translate-y-0 gap-0 overflow-hidden rounded-lg p-0 sm:top-[12vh] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, actions and documents. Use the arrow keys to move and Enter to run.
        </DialogDescription>
        <CommandPrimitive label="Command menu" loop className="flex flex-col">
          <div className="flex h-12 items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
            <CommandPrimitive.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search pages and actions"
              className="h-full flex-1 bg-transparent text-md outline-hidden placeholder:text-subtle-foreground md:text-base"
            />
            <Kbd>Esc</Kbd>
          </div>
          <CommandPrimitive.List className="max-h-[min(60vh,420px)] overflow-y-auto py-1">
            <CommandPrimitive.Empty className="px-4 py-8 text-center text-base text-muted-foreground">
              No results for “{search}”
            </CommandPrimitive.Empty>
            <CommandPrimitive.Group heading="Go to" className={groupClass}>
              {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
                <Item
                  key={item.href}
                  value={`go ${item.label}`}
                  icon={<item.icon aria-hidden="true" />}
                  hint={item.shortcut ? `G ${item.shortcut}` : undefined}
                  onSelect={() => {
                    go(item.href);
                  }}
                >
                  {item.label}
                </Item>
              ))}
            </CommandPrimitive.Group>
            <CommandPrimitive.Group heading="Actions" className={groupClass}>
              <Item
                value="Sync GitHub now"
                icon={<RefreshCw aria-hidden="true" />}
                disabled={Boolean(syncReason)}
                hint={syncReason}
                onSelect={() => {
                  close();
                  startSync.mutate(undefined, {
                    onSuccess: (result) =>
                      toast.info(
                        result.alreadyRunning ? 'A sync is already running' : 'Sync started',
                      ),
                    onError: (error) => toast.error(errorMessage(error, 'the sync')),
                  });
                }}
              >
                Sync GitHub now
              </Item>
              <Item
                value="New appraisal"
                icon={<FileText aria-hidden="true" />}
                onSelect={() => {
                  go('/documents/new/appraisal');
                }}
              >
                New appraisal
              </Item>
              <Item
                value="New promotion packet"
                icon={<TrendingUp aria-hidden="true" />}
                onSelect={() => {
                  go('/documents/new/promotion');
                }}
              >
                New promotion packet
              </Item>
              <Item
                value="New resume bullets"
                icon={<ListChecks aria-hidden="true" />}
                onSelect={() => {
                  go('/documents/new/resume');
                }}
              >
                New resume bullets
              </Item>
              <Item
                value="Add achievement"
                icon={<Award aria-hidden="true" />}
                hint="A"
                onSelect={() => {
                  go('/achievements');
                }}
              >
                Add achievement
              </Item>
              <Item
                value="Add goal"
                icon={<Target aria-hidden="true" />}
                onSelect={() => {
                  go('/goals');
                }}
              >
                Add goal
              </Item>
              <Item
                value="Change period"
                icon={<Calendar aria-hidden="true" />}
                onSelect={() => {
                  close();
                  if (!PERIOD_PATHS.has(pathname)) router.push('/dashboard');
                  window.setTimeout(
                    () => {
                      shell.setPeriodOpen(true);
                    },
                    PERIOD_PATHS.has(pathname) ? 0 : 400,
                  );
                }}
              >
                Change period…
              </Item>
              <Item
                value="Switch theme system light dark"
                icon={<SunMoon aria-hidden="true" />}
                hint={`Now: ${theme ?? 'system'}`}
                onSelect={() => {
                  setTheme(nextTheme(theme));
                }}
              >
                Switch theme (system / light / dark)
              </Item>
            </CommandPrimitive.Group>
            <CommandPrimitive.Group heading="Documents" className={groupClass}>
              {documents.isPending ? (
                <CommandPrimitive.Loading>
                  <div className="flex items-center gap-2 px-2.5 py-2 text-base text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Loading documents…
                  </div>
                </CommandPrimitive.Loading>
              ) : documents.isError ? (
                <div className="px-2.5 py-2 text-base text-muted-foreground" role="status">
                  Couldn&apos;t search documents
                </div>
              ) : (
                documents.data.items.map((doc) => (
                  <Item
                    key={doc.id}
                    value={`document ${doc.title} ${doc.id}`}
                    icon={<File aria-hidden="true" />}
                    onSelect={() => {
                      go(`/documents/${doc.id}`);
                    }}
                  >
                    {doc.title}
                  </Item>
                ))
              )}
            </CommandPrimitive.Group>
            <CommandPrimitive.Group heading="Help" className={groupClass}>
              <Item
                value="How metrics work"
                icon={<Gauge aria-hidden="true" />}
                onSelect={() => {
                  go('/kpis');
                }}
              >
                How metrics work
              </Item>
              <Item
                value="Keyboard shortcuts"
                icon={<Keyboard aria-hidden="true" />}
                hint="?"
                onSelect={() => {
                  close();
                  shell.setShortcutsOpen(true);
                }}
              >
                Keyboard shortcuts
              </Item>
            </CommandPrimitive.Group>
          </CommandPrimitive.List>
          <div
            className={cn(
              'hidden items-center gap-4 border-t px-3 py-2 text-caption text-subtle-foreground sm:flex',
            )}
          >
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
            </span>
            <span>
              <Kbd>Enter</Kbd> to select
            </span>
            <span>
              <Kbd>G</Kbd> then <Kbd>D</Kbd> dashboard
            </span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
