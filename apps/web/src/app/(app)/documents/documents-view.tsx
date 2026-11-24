'use client';

import { type DocumentSummary, type StudioDocumentType } from '@devimpact/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Ellipsis, FileText, Plus, Search, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RenameDialog } from '@/components/documents/rename-dialog';
import { StatusBadge, UncitedBadge } from '@/components/documents/status-badge';
import { useConnected } from '@/components/not-connected-state';
import { QuotaMeter } from '@/components/quota-meter';
import { EmptyState, ErrorState, PageHeader } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  isGenerating,
  useDeleteDocument,
  useDocumentLibrary,
  useRegenerateAny,
  useUsage,
  type LibrarySort,
} from '@/lib/api/document-hooks';
import { errorMessage } from '@/lib/api/errors';
import { qk } from '@/lib/api/query-keys';
import { coverageLabel, generationErrorCopy, typeLabel } from '@/lib/documents';
import { formatDate, plural } from '@/lib/format';
import { useSearchParamsState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

const TYPE_CHIPS: { value: StudioDocumentType | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'appraisal', label: 'Appraisals' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'resume', label: 'Resume' },
];

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: '-updatedAt', label: 'Last updated' },
  { value: '-createdAt', label: 'Newest first' },
  { value: 'title', label: 'Title A–Z' },
];

const STUDIO_TYPES = new Set<string>(['resume', 'appraisal', 'promotion']);
const UNDO_MS = 7000;

/** Soft-delete window (S11 Success): deletes run after 7 s unless undone, even after navigating. */
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

export function NewDocumentMenu({ align = 'end' }: { align?: 'start' | 'end' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          New document
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem asChild>
          <Link href="/documents/new/appraisal">Appraisal</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/documents/new/promotion">Promotion packet</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/documents/new/resume">Resume bullets</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/documents/new">Compare document types</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Documents library (S11, F-48): type chips, search, sort (URL state `?type=&q=&sort=`), cursor
 * pages, status / "N uncited" badges, usage meter, row menu (Open, Rename, Duplicate options,
 * Retry, Delete with a 7 s Undo).
 */
export function DocumentsView() {
  const connected = useConnected();
  const url = useSearchParamsState();
  const rawType = url.get('type');
  const type = rawType && STUDIO_TYPES.has(rawType) ? (rawType as StudioDocumentType) : undefined;
  const q = url.get('q') ?? '';
  const rawSort = url.get('sort');
  const sort = SORTS.some((s) => s.value === rawSort) ? (rawSort as LibrarySort) : '-updatedAt';
  const library = useDocumentLibrary({ type, q: q.trim() || undefined, sort });
  const usage = useUsage();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const remove = useDeleteDocument();
  const queryClient = useQueryClient();

  const items = (library.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (d) => !hidden.has(d.id),
  );
  const total = library.data?.pages[0]?.meta.total;
  const filtered = type !== undefined || q !== '';
  const gens = usage.data?.generations;

  const scheduleDelete = (doc: DocumentSummary) => {
    setHidden((h) => new Set(h).add(doc.id));
    const restore = () => {
      const timer = scheduled.get(doc.id);
      if (timer) clearTimeout(timer);
      scheduled.delete(doc.id);
      setHidden((h) => {
        const next = new Set(h);
        next.delete(doc.id);
        return next;
      });
    };
    scheduled.set(
      doc.id,
      setTimeout(() => {
        scheduled.delete(doc.id);
        remove.mutate(doc.id, {
          onError: (e) => {
            restore();
            toast.error(`Couldn't delete “${doc.title}”. ${errorMessage(e, 'the document')}`);
          },
        });
      }, UNDO_MS),
    );
    toast(`Deleted “${doc.title}”`, {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: restore },
    });
  };

  const header = (
    <PageHeader
      title="Documents"
      lede={
        total !== undefined && !filtered
          ? `${plural(total, 'document')} · drafts are saved automatically`
          : 'Appraisals, promotion packets and resume bullets written from your evidence.'
      }
      actions={<NewDocumentMenu />}
    />
  );

  if (!connected && library.data && items.length === 0 && !filtered) {
    return (
      <>
        {header}
        <div className="rounded-md border bg-card" data-testid="not-connected">
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Connect GitHub first — documents are written from your real pull requests and reviews."
            headingLevel={2}
            actions={
              <Button asChild>
                <Link href="/onboarding/connect">Connect GitHub</Link>
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {gens ? (
          <div className="rounded-md border bg-card p-4" data-testid="library-quota">
            <QuotaMeter
              label="AI document generations"
              used={gens.used}
              limit={gens.limit}
              resetsAt={gens.resetsAt}
              note="Reused results are free"
            />
          </div>
        ) : null}
        <Filters
          type={type}
          q={q}
          sort={sort}
          onType={(t) => {
            url.set({ type: t }, { replace: true });
          }}
          onQuery={(text) => {
            url.set({ q: text || null }, { replace: true });
          }}
          onSort={(s) => {
            url.set({ sort: s === '-updatedAt' ? null : s }, { replace: true });
          }}
        />
        <div className="rounded-md border bg-card">
          {library.isPending ? (
            <LibrarySkeleton />
          ) : library.isError && !library.data ? (
            <ErrorState
              error={library.error}
              what="your documents"
              onRetry={() => void library.refetch()}
              headingLevel={2}
            />
          ) : items.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={SearchX}
                title="No documents match"
                description="Try another type or search term."
                headingLevel={2}
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      url.set({ type: null, q: null }, { replace: true });
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No documents yet"
                description="Draft an appraisal, promotion packet or resume bullets. Every claim links to the work behind it."
                headingLevel={2}
                actions={<NewDocumentMenu align="start" />}
              />
            )
          ) : (
            <LibraryTable
              items={items}
              onDelete={scheduleDelete}
              onRetried={() =>
                void queryClient.invalidateQueries({ queryKey: qk.documents.active() })
              }
            />
          )}
        </div>
        {library.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-center"
            loading={library.isFetchingNextPage}
            onClick={() => void library.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </div>
    </>
  );
}

function Filters({
  type,
  q,
  sort,
  onType,
  onQuery,
  onSort,
}: {
  type: StudioDocumentType | undefined;
  q: string;
  sort: LibrarySort;
  onType: (type: StudioDocumentType | null) => void;
  onQuery: (q: string) => void;
  onSort: (sort: LibrarySort) => void;
}) {
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => {
      onQuery(text.trim());
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [text, q, onQuery]);
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <div role="group" aria-label="Type" className="flex flex-wrap gap-1.5">
        {TYPE_CHIPS.map((chip) => {
          const pressed = (type ?? null) === chip.value;
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                onType(chip.value);
              }}
              className={cn(
                'h-7 cursor-pointer rounded-full border px-3 text-base text-muted-foreground hover:bg-surface-2',
                pressed &&
                  'border-accent-foreground/30 bg-accent font-medium text-accent-foreground',
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row md:justify-end">
        <div className="relative sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle-foreground"
            aria-hidden="true"
          />
          <label htmlFor="documents-q" className="sr-only">
            Search documents
          </label>
          <Input
            id="documents-q"
            type="search"
            placeholder="Search documents"
            className="pl-8"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </div>
        <label htmlFor="documents-sort" className="sr-only">
          Sort
        </label>
        <select
          id="documents-sort"
          value={sort}
          onChange={(e) => {
            onSort(e.target.value as LibrarySort);
          }}
          className="h-9 rounded-sm border border-input bg-surface px-2 text-md md:h-8 md:text-base"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="flex flex-col divide-y" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-20 md:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
      <span className="sr-only" role="status">
        Loading your documents…
      </span>
    </div>
  );
}

function LibraryTable({
  items,
  onDelete,
  onRetried,
}: {
  items: DocumentSummary[];
  onDelete: (doc: DocumentSummary) => void;
  onRetried: () => void;
}) {
  const router = useRouter();
  const retry = useRegenerateAny();
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  return (
    <>
      <table className="w-full text-base" data-testid="documents-table">
        <caption className="sr-only">Documents</caption>
        <thead className="hidden border-b text-left text-caption text-subtle-foreground md:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Period
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Version
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Evidence
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Updated
            </th>
            <th scope="col" className="w-10 px-2 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((doc) => {
            const flagged = (doc.flags?.uncited ?? 0) + (doc.flags?.invalid ?? 0);
            const coverage = coverageLabel(doc.citationCoverage);
            return (
              <tr
                key={doc.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-4 py-3 hover:bg-surface-2 md:table-row md:p-0"
                data-testid="document-row"
              >
                <td className="min-w-0 md:px-4 md:py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="min-w-0 truncate font-medium text-foreground hover:underline"
                    >
                      {doc.title}
                    </Link>
                    {doc.status !== 'ready' ? <StatusBadge status={doc.status} /> : null}
                    <UncitedBadge count={flagged} />
                  </div>
                </td>
                <td className="col-start-1 row-start-2 text-caption text-muted-foreground md:table-cell md:px-2 md:py-2.5 md:text-base">
                  <span className="md:hidden">
                    {[
                      typeLabel(doc.type),
                      doc.period?.label,
                      `v${doc.currentVersion}`,
                      formatDate(doc.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <Badge variant="outline" className="hidden md:inline-flex">
                    {typeLabel(doc.type)}
                  </Badge>
                </td>
                <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">
                  {doc.period?.label ?? 'Imported'}
                </td>
                <td className="hidden px-2 py-2.5 text-right tabular-nums md:table-cell">
                  v{doc.currentVersion}
                </td>
                <td className="hidden px-2 py-2.5 text-right tabular-nums md:table-cell">
                  {coverage ? `${Math.round((doc.citationCoverage ?? 0) * 100)}% cited` : '—'}
                </td>
                <td className="hidden px-2 py-2.5 text-muted-foreground md:table-cell">
                  {formatDate(doc.updatedAt)}
                </td>
                <td className="col-start-2 row-span-2 row-start-1 self-center md:px-2 md:py-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${doc.title}`}
                      >
                        <Ellipsis aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          router.push(`/documents/${doc.id}`);
                        }}
                      >
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isGenerating(doc.status)}
                        onSelect={() => {
                          setRenaming(doc);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      {STUDIO_TYPES.has(doc.type) && doc.period ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            router.push(`/documents/new/${doc.type}?from=${doc.id}`);
                          }}
                        >
                          Duplicate options
                        </DropdownMenuItem>
                      ) : null}
                      {doc.status === 'failed' || doc.status === 'cancelled' ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            retry.mutate(
                              { id: doc.id, body: {} },
                              {
                                onSuccess: () => {
                                  onRetried();
                                  router.push(`/documents/${doc.id}`);
                                },
                                onError: (e) => toast.error(generationErrorCopy(e)),
                              },
                            );
                          }}
                        >
                          Retry
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          onDelete(doc);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {renaming ? (
        <RenameDialog
          open
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          documentId={renaming.id}
          title={renaming.title}
          baseVersion={renaming.currentVersion}
        />
      ) : null}
    </>
  );
}
