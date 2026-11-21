'use client';

import {
  documentSections,
  flaggedClaims,
  moveContentItem,
  REGENERABLE_SECTIONS,
  toExportDocument,
  toMarkdown,
  toPlainText,
  updateContentItem,
  writtenSections,
  type DocumentDetail,
  type DocumentStreamEvent,
  type ExportFormatWire,
  type RenderSection,
  type StudioDocumentType,
} from '@devimpact/shared';
import {
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  Ellipsis,
  FileCode,
  FileText,
  FileType,
  Pencil,
  RotateCw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DocumentRenderer, type StreamingView } from '@/components/documents/document-renderer';
import { RenameDialog } from '@/components/documents/rename-dialog';
import { ResumeBullets, type BulletActions } from '@/components/documents/resume-bullets';
import { StatusBadge } from '@/components/documents/status-badge';
import { LiveAnnouncer, StreamingStatus } from '@/components/documents/streaming-status';
import { VersionList } from '@/components/documents/version-list';
import { EvidenceChip } from '@/components/evidence-chip';
import { Banner, ConfirmDialog, EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentStream } from '@/hooks/use-document-stream';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  isGenerating,
  useCancelDocument,
  useDeleteDocument,
  useDocumentDetail,
  useDocumentVersions,
  useExportDocument,
  useRegenerateDocument,
  useRestoreVersion,
  useUpdateDocument,
} from '@/lib/api/document-hooks';
import { errorMessage, isApiError } from '@/lib/api/errors';
import {
  coverageLabel,
  generationErrorCopy,
  readyToastText,
  streamErrorCopy,
  typeLabel,
} from '@/lib/documents';
import { plural } from '@/lib/format';
import { useSearchParamsState } from '@/lib/url-state';

const DocumentEditor = dynamic(() => import('@/components/documents/document-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  ),
});

const STUDIO = new Set(['resume', 'appraisal', 'promotion']);
const AUTOSAVE_MS = 900;
const WAIT_REASON = 'Available when the draft is finished';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'invalid';

/** Every claim / item still has text (the API rejects empty ones). */
function complete(content: unknown): boolean {
  if (Array.isArray(content)) return content.every(complete);
  if (!content || typeof content !== 'object') return true;
  const obj = content as Record<string, unknown>;
  if (typeof obj.text === 'string' && !obj.text.trim()) return false;
  if (typeof obj.title === 'string' && !obj.title.trim()) return false;
  return Object.values(obj).every(complete);
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error('Copy was blocked by the browser. Select the text and copy it manually.');
  }
}

/**
 * Document viewer / editor (S16, FLOWS F5/F6): live streaming (SSE with polling fallback),
 * rendered sections with citation popovers and flags, structured editing with autosave and
 * version conflicts, versions (`?version=`) with restore, regenerate (whole, options, section),
 * export (copy Markdown / text, download PDF / DOCX / Markdown), rename and delete.
 */
export function DocumentView({ id }: { id: string }) {
  const router = useRouter();
  const url = useSearchParamsState();
  const rawVersion = url.get('version');
  const selectedVersion = rawVersion && /^\d{1,4}$/.test(rawVersion) ? Number(rawVersion) : null;
  const [pollFallback, setPollFallback] = useState(false);
  const current = useDocumentDetail(id, { poll: pollFallback });
  const viewed = useDocumentDetail(selectedVersion ? id : null, {
    version: selectedVersion ?? undefined,
  });
  const doc = current.data?.document;
  const versions = useDocumentVersions(doc ? id : null);
  const [announcement, setAnnouncement] = useState('');
  const [rewriting, setRewriting] = useState<string | null>(null);

  const stream = useDocumentStream(id, {
    status: doc?.status,
    type: doc?.type,
    onTerminal: (event: DocumentStreamEvent) => {
      setRewriting(null);
      if (event.event === 'done') {
        const text = readyToastText({
          type: doc?.type ?? 'appraisal',
          citationCoverage: event.data.citationCoverage,
        });
        toast.success(text);
        setAnnouncement(text.replace(' —', ',').replace(/\.$/, ''));
      } else if (event.event === 'error') {
        setAnnouncement("The draft couldn't be finished.");
      } else {
        setAnnouncement('Generation stopped.');
      }
    },
  });

  useEffect(() => {
    if (stream.fallback) setPollFallback(true);
  }, [stream.fallback]);
  useEffect(() => {
    if (!isGenerating(doc?.status)) setPollFallback(false);
  }, [doc?.status]);
  const step = stream.step;
  useEffect(() => {
    if (step) setAnnouncement(`Writing section ${step.index} of ${step.total}`);
  }, [step]);

  if (current.isPending) return <ViewerSkeleton />;
  if (current.isError) {
    if (isApiError(current.error) && current.error.code === 'NOT_FOUND') {
      return (
        <div className="rounded-md border bg-card">
          <EmptyState
            icon={FileText}
            headingLevel={1}
            title="This document was deleted"
            description="It may have been deleted in another tab or window."
            actions={
              <Button asChild>
                <Link href="/documents">Back to documents</Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <ErrorState
        error={current.error}
        what="this document"
        headingLevel={1}
        onRetry={() => void current.refetch()}
      />
    );
  }
  if (!doc || !current.data) return <ViewerSkeleton />;

  return (
    <LoadedDocument
      key={doc.id}
      detail={current.data}
      viewed={selectedVersion ? (viewed.data ?? null) : null}
      viewedLoading={selectedVersion !== null && viewed.isPending}
      viewedMissing={selectedVersion !== null && viewed.isError}
      selectedVersion={selectedVersion}
      versions={versions.data?.items}
      versionsLoading={versions.isPending}
      stream={stream}
      rewriting={rewriting}
      setRewriting={setRewriting}
      announcement={announcement}
      hrefFor={(v) => url.hrefWith({ version: v === null ? null : String(v) })}
      onDeleted={() => {
        router.push('/documents');
      }}
    />
  );
}

function ViewerSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,720px)_320px]">
        <div className="flex flex-col gap-6 rounded-md border bg-card p-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-10/12" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 rounded-md" />
          <Skeleton className="h-32 rounded-md" />
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading the document…
      </span>
    </div>
  );
}

function LoadedDocument({
  detail,
  viewed,
  viewedLoading,
  viewedMissing,
  selectedVersion,
  versions,
  versionsLoading,
  stream,
  rewriting,
  setRewriting,
  announcement,
  hrefFor,
  onDeleted,
}: {
  detail: DocumentDetail;
  viewed: DocumentDetail | null;
  viewedLoading: boolean;
  viewedMissing: boolean;
  selectedVersion: number | null;
  versions:
    { number: number; source: 'ai' | 'user_edit' | 'restore'; createdAt: string }[] | undefined;
  versionsLoading: boolean;
  stream: ReturnType<typeof useDocumentStream>;
  rewriting: string | null;
  setRewriting: (key: string | null) => void;
  announcement: string;
  hrefFor: (version: number | null) => string;
  onDeleted: () => void;
}) {
  const doc = detail.document;
  const id = doc.id;
  const router = useRouter();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const generating = isGenerating(doc.status);
  const legacy = Boolean(
    detail.version &&
    typeof detail.version.content === 'object' &&
    detail.version.content !== null &&
    (detail.version.content as { legacy?: unknown }).legacy === true,
  );
  const studio = STUDIO.has(doc.type);
  const versionView = selectedVersion !== null && selectedVersion !== doc.currentVersion;
  const shown = versionView ? viewed : detail;

  // ── Editing + autosave ─────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState<number | null>(null);
  const baseRef = useRef(doc.currentVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useUpdateDocument(id);
  useEffect(() => {
    if (!editing) baseRef.current = doc.currentVersion;
  }, [doc.currentVersion, editing]);

  const persist = useCallback(
    (content: unknown, baseVersion: number) => {
      setSave('saving');
      update.mutate(
        { baseVersion, content },
        {
          onSuccess: (res) => {
            baseRef.current = res.document.currentVersion;
            setSave('saved');
          },
          onError: (e) => {
            if (isApiError(e) && e.code === 'VERSION_CONFLICT') {
              const latest = (e.details as { currentVersion?: number } | null)?.currentVersion;
              setConflict(typeof latest === 'number' ? latest : baseVersion + 1);
              setSave('error');
              return;
            }
            setSave('error');
            toast.error(`Couldn't save your edit. ${errorMessage(e, 'the document')}`);
          },
        },
      );
    },
    [update],
  );

  const onEdit = (content: unknown) => {
    setDraft(content);
    if (timer.current) clearTimeout(timer.current);
    if (!complete(content)) {
      setSave('invalid');
      return;
    }
    setSave('saving');
    timer.current = setTimeout(() => {
      persist(content, baseRef.current);
    }, AUTOSAVE_MS);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const startEditing = () => {
    setDraft(detail.version?.content ?? null);
    baseRef.current = doc.currentVersion;
    setSave('idle');
    setEditing(true);
  };
  const finishEditing = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      if (draft !== null && complete(draft) && save === 'saving' && !update.isPending) {
        persist(draft, baseRef.current);
      }
    }
    setEditing(false);
    if (save === 'saved' || update.isPending) toast.success(`Saved as v${baseRef.current}`);
  };

  // ── Mutations ──────────────────────────────────────────────────────────────────────────
  const restore = useRestoreVersion(id);
  const regenerate = useRegenerateDocument(id);
  const cancel = useCancelDocument(id);
  const remove = useDeleteDocument();
  const exporter = useExportDocument();
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  const doRestore = (v: number) => {
    setRestoring(v);
    restore.mutate(v, {
      onSuccess: (res) => {
        toast.success(`Restored v${v} as v${res.document.currentVersion}`);
        router.replace(hrefFor(null), { scroll: false });
      },
      onError: (e) => toast.error(generationErrorCopy(e)),
      onSettled: () => {
        setRestoring(null);
      },
    });
  };

  const doRegenerate = (section?: string) => {
    if (section) setRewriting(section);
    stream.reset();
    regenerate.mutate(section ? { section } : {}, {
      onSuccess: () => {
        if (section) {
          const label = writtenSections(doc.type).find((s) => s.key === section)?.label ?? section;
          toast.info(`Rewriting “${label}”… saved as v${doc.currentVersion + 1}.`);
        }
      },
      onError: (e) => {
        setRewriting(null);
        toast.error(generationErrorCopy(e));
      },
    });
  };

  const exportFile = (format: ExportFormatWire) => {
    const vars = {
      id,
      format,
      version: versionView ? (selectedVersion ?? undefined) : undefined,
      fallback: {
        type: doc.type,
        period: doc.period?.spec,
        version: shown?.version?.number ?? doc.currentVersion,
      },
    };
    exporter.mutate(vars, {
      onSuccess: (name) => toast.success(`Downloaded ${name}`),
      onError: (e) =>
        toast.error(`Couldn't export the document. ${errorMessage(e, 'the export')}`, {
          action: {
            label: 'Try again',
            onClick: () => {
              exporter.mutate(vars);
            },
          },
        }),
    });
  };

  const exportDoc = useMemo(
    () =>
      shown?.version
        ? toExportDocument({
            type: doc.type,
            title: doc.title,
            periodLabel: doc.period?.label ?? null,
            version: shown.version.number,
            content: shown.version.content,
            evidence: shown.document.evidence,
          })
        : null,
    [shown, doc.type, doc.title, doc.period?.label],
  );

  // ── Content to render ──────────────────────────────────────────────────────────────────
  const savedContent = shown?.version?.content ?? null;
  const showStream =
    generating &&
    !rewriting &&
    (stream.phase === 'queued' || stream.phase === 'writing' || !savedContent);
  const content = showStream ? stream.content : savedContent;
  const rendered = useMemo(() => documentSections(doc.type, content), [doc.type, content]);
  const flagged = generating ? 0 : flaggedClaims(rendered.sections);
  const resolved = shown?.document.evidence ?? doc.evidence;
  // While streaming, the saved evidence isn't known yet: list the refs cited so far.
  const evidence = useMemo(() => {
    if (!showStream) return resolved;
    const known = new Map(resolved.map((e) => [e.ref, e]));
    const refs = rendered.sections.flatMap((s) =>
      s.kind === 'items' ? s.items.flatMap((i) => i.citations) : [],
    );
    return [...new Set(refs)].map(
      (ref) =>
        known.get(ref) ?? {
          ref,
          kind: ref.startsWith('REV-')
            ? ('review' as const)
            : ref.startsWith('C-')
              ? ('commit' as const)
              : ref.startsWith('ACH-')
                ? ('achievement' as const)
                : ('pull_request' as const),
          id: ref,
          title: ref.replace(/^(PR|REV|C|ACH)-/, ''),
          repo: null,
          url: null,
          occurredAt: new Date(0).toISOString(),
        },
    );
  }, [showStream, resolved, rendered.sections]);

  const streamingView: StreamingView | null = showStream
    ? {
        currentKey: stream.currentKey,
        draft: stream.draft,
        pendingKeys: writtenSections(doc.type)
          .map((s) => s.key)
          .filter((k) => k !== stream.currentKey),
      }
    : null;

  const canCurate = !generating && !versionView && !legacy && !editing && doc.type === 'resume';
  const bulletActions: BulletActions | null = canCurate
    ? {
        copy: (text) => void copyText(text, 'Copied bullet'),
        togglePin: (index, pinned) => {
          let next = updateContentItem(savedContent, 'bullets', index, { pinned });
          if (pinned) {
            const bullets = documentSections('resume', next).sections.find(
              (s) => s.key === 'bullets',
            );
            const firstUnpinned =
              bullets?.kind === 'items'
                ? bullets.items.findIndex((b) => !b.pinned || b.index === index)
                : 0;
            if (firstUnpinned >= 0 && firstUnpinned < index)
              next = moveContentItem(next, 'bullets', index, firstUnpinned);
          }
          persistCuration(next, pinned ? 'Pinned' : 'Unpinned');
        },
        toggleUsed: (index, used) => {
          persistCuration(
            updateContentItem(savedContent, 'bullets', index, { used }),
            used ? 'Marked as used' : 'Unmarked',
          );
        },
        move: (from, to) => {
          persistCuration(moveContentItem(savedContent, 'bullets', from, to), 'Moved');
        },
      }
    : null;

  function persistCuration(next: unknown, done: string) {
    update.mutate(
      { baseVersion: doc.currentVersion, content: next },
      {
        onSuccess: (res) => toast.success(`${done} · saved as v${res.document.currentVersion}`),
        onError: (e) =>
          toast.error(
            isApiError(e) && e.code === 'VERSION_CONFLICT'
              ? 'A newer version exists. Reload the page and try again.'
              : `Couldn't save. ${errorMessage(e, 'the document')}`,
          ),
      },
    );
  }

  const regenerable = studio && !legacy ? REGENERABLE_SECTIONS[doc.type as StudioDocumentType] : [];
  const sectionLabels = new Map(writtenSections(doc.type).map((s) => [s.key, s.label]));
  const actionsDisabled = generating || editing;
  const coverage = coverageLabel(doc.citationCoverage);
  const versionCount = versions?.length ?? doc.currentVersion;

  return (
    <div className="flex flex-col gap-4">
      <LiveAnnouncer message={announcement} />
      {/* Header */}
      <header className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{typeLabel(doc.type)}</Badge>
            <span className="text-caption text-subtle-foreground">
              {[
                doc.period?.label ?? (legacy ? 'Imported from v0.1' : null),
                doc.currentVersion > 0 ? `v${doc.currentVersion}` : null,
                detail.version?.source === 'user_edit' ? 'edited' : null,
                doc.model !== 'unknown' ? doc.model : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {doc.status !== 'ready' ? <StatusBadge status={doc.status} /> : null}
            {!generating && coverage ? (
              <Badge variant={flagged ? 'warning' : 'neutral'} data-testid="coverage-badge">
                {coverage}
              </Badge>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{doc.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <span
                className="text-caption text-subtle-foreground"
                role="status"
                data-testid="save-status"
              >
                {save === 'saving'
                  ? 'Saving…'
                  : save === 'invalid'
                    ? 'Fill in empty claims to save'
                    : save === 'error'
                      ? 'Not saved'
                      : save === 'saved'
                        ? `Saved · v${baseRef.current}`
                        : 'Edits save automatically'}
              </span>
              <Button onClick={finishEditing}>Done</Button>
            </>
          ) : (
            <>
              {studio && !legacy ? (
                <>
                  <Button
                    variant="secondary"
                    className="hidden md:inline-flex"
                    disabled={actionsDisabled || versionView || !detail.version}
                    title={
                      generating
                        ? WAIT_REASON
                        : versionView
                          ? 'Restore this version to edit it'
                          : undefined
                    }
                    onClick={startEditing}
                  >
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        className="hidden md:inline-flex"
                        disabled={actionsDisabled}
                        title={generating ? WAIT_REASON : undefined}
                      >
                        <RotateCw aria-hidden="true" />
                        Regenerate
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <RegenerateMenu
                      doc={doc}
                      sections={regenerable}
                      labels={sectionLabels}
                      canSection={doc.currentVersion > 0}
                      onWhole={() => {
                        setConfirmRegen(true);
                      }}
                      onSection={doRegenerate}
                    />
                  </DropdownMenu>
                </>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={!shown?.version || (generating && !versionView)}
                    title={generating ? WAIT_REASON : undefined}
                    loading={exporter.isPending}
                  >
                    <Download aria-hidden="true" />
                    Export
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!exportDoc}
                    onSelect={() =>
                      exportDoc && void copyText(toMarkdown(exportDoc), 'Copied as Markdown')
                    }
                  >
                    <Copy aria-hidden="true" />
                    Copy as Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!exportDoc}
                    onSelect={() =>
                      exportDoc && void copyText(toPlainText(exportDoc), 'Copied as plain text')
                    }
                  >
                    <Clipboard aria-hidden="true" />
                    Copy as plain text
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      exportFile('pdf');
                    }}
                  >
                    <FileType aria-hidden="true" />
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      exportFile('docx');
                    }}
                  >
                    <FileText aria-hidden="true" />
                    Download DOCX
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      exportFile('md');
                    }}
                  >
                    <FileCode aria-hidden="true" />
                    Download Markdown
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <Ellipsis aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {studio && !legacy ? (
                    <>
                      <DropdownMenuItem
                        className="md:hidden"
                        disabled={actionsDisabled || versionView || !detail.version}
                        onSelect={startEditing}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="md:hidden"
                        disabled={actionsDisabled}
                        onSelect={() => {
                          setConfirmRegen(true);
                        }}
                      >
                        <RotateCw aria-hidden="true" />
                        Regenerate document
                      </DropdownMenuItem>
                      <DropdownMenuItem className="md:hidden" disabled={actionsDisabled} asChild>
                        <Link href={`/documents/new/${doc.type}?regenerate=${id}`}>
                          <SlidersHorizontal aria-hidden="true" />
                          Change options and regenerate
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="md:hidden" />
                    </>
                  ) : null}
                  <DropdownMenuItem
                    disabled={generating}
                    onSelect={() => {
                      setRenaming(true);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete document
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>

      {/* Status banners */}
      {generating && showStream ? (
        <StreamingStatus
          step={stream.step}
          queued={
            stream.phase === 'queued' || (stream.phase === 'idle' && doc.status === 'pending')
          }
          onStop={() => {
            cancel.mutate(undefined, {
              onSuccess: () =>
                toast.info('Generation stopped. Nothing was counted against your quota.'),
              onError: (e) => toast.error(errorMessage(e, 'the generation')),
            });
          }}
          stopping={cancel.isPending}
        />
      ) : null}
      {generating && rewriting ? (
        <Banner
          tone="info"
          title={`Rewriting “${sectionLabels.get(rewriting) ?? rewriting}”`}
          role="none"
        >
          The rest of the document stays as it is. The result is saved as a new version.
        </Banner>
      ) : null}
      {!generating && doc.status === 'failed' ? (
        <Banner
          tone="danger"
          role="alert"
          title="The draft couldn't be finished"
          actions={
            studio && !legacy ? (
              <Button
                size="sm"
                onClick={() => {
                  doRegenerate();
                }}
                loading={regenerate.isPending}
              >
                Try again
              </Button>
            ) : undefined
          }
        >
          {streamErrorCopy(stream.error?.code ?? doc.errorCode ?? '')}
          {doc.currentVersion > 0 ? ' The previous version is shown below.' : ''}
        </Banner>
      ) : null}
      {!generating && doc.status === 'cancelled' ? (
        <Banner
          tone="neutral"
          role="status"
          title="Generation stopped"
          actions={
            studio && !legacy ? (
              <Button
                size="sm"
                onClick={() => {
                  doRegenerate();
                }}
                loading={regenerate.isPending}
              >
                Generate again
              </Button>
            ) : undefined
          }
        >
          Nothing was counted against your quota.
          {doc.currentVersion > 0
            ? ' The previous version is shown below.'
            : ' The partial draft was not saved.'}
        </Banner>
      ) : null}
      {legacy ? (
        <Banner tone="info" title="Imported from DevImpact v0.1" role="none">
          This version is read-only. Generate a new document to get citations, versions and editing.
        </Banner>
      ) : null}
      {versionView ? (
        <Banner
          tone="neutral"
          role="none"
          title={`You're viewing v${selectedVersion}`}
          actions={
            <>
              <Button size="sm" variant="secondary" asChild>
                <Link href={hrefFor(null)}>Back to current</Link>
              </Button>
              {!legacy && !viewedMissing ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (selectedVersion) doRestore(selectedVersion);
                  }}
                  loading={restoring === selectedVersion}
                  disabled={generating}
                >
                  Restore this version
                </Button>
              ) : null}
            </>
          }
        >
          {viewedMissing
            ? 'This version is no longer available.'
            : 'Older versions are read-only. Restoring creates a new version.'}
        </Banner>
      ) : null}
      {flagged > 0 && !editing ? (
        <Banner
          tone="warning"
          title={`${plural(flagged, 'claim has', 'claims have')} no evidence`}
          role="none"
        >
          Underlined claims aren&apos;t backed by a PR, review or achievement. Edit them, link an
          achievement, or remove them before sharing.
        </Banner>
      ) : null}

      {/* Body + aside */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,720px)_320px]">
        <article
          aria-label="Document"
          className="min-w-0 rounded-md border bg-card px-4 py-5 md:px-8 md:py-7"
        >
          {versionView && viewedLoading ? (
            <ViewerSkeletonBody />
          ) : editing ? (
            <DocumentEditor type={doc.type} content={draft} onChange={onEdit} />
          ) : rendered.sections.length === 0 && !streamingView ? (
            <p className="text-base text-muted-foreground">
              {doc.status === 'pending'
                ? 'Queued — starting in a moment.'
                : 'This document has no content yet.'}
            </p>
          ) : (
            <DocumentRenderer
              type={doc.type}
              sections={rendered.sections}
              evidence={evidence}
              streaming={streamingView}
              rewriting={rewriting}
              renderItems={(section: Extract<RenderSection, { kind: 'items' }>) =>
                doc.type === 'resume' && section.key === 'bullets' && section.shape === 'claims' ? (
                  <ResumeBullets
                    section={section}
                    byRef={new Map(evidence.map((e) => [e.ref, e]))}
                    actions={bulletActions}
                  />
                ) : null
              }
            />
          )}
        </article>
        <aside className="flex flex-col gap-4">
          <EvidencePanel evidence={evidence} desktop={desktop} streaming={generating} />
          <section className="rounded-md border bg-card" aria-labelledby="versions-h">
            <div className="flex items-baseline justify-between border-b px-4 py-3">
              <h2 id="versions-h" className="text-lg font-semibold">
                Versions
              </h2>
              {versionCount ? (
                <span className="text-caption text-subtle-foreground">
                  {plural(versionCount, 'version')}
                </span>
              ) : null}
            </div>
            <VersionList
              versions={versions}
              current={doc.currentVersion}
              selected={selectedVersion}
              hrefFor={hrefFor}
              onRestore={doRestore}
              restoring={restoring}
              disabledReason={
                generating
                  ? WAIT_REASON
                  : editing
                    ? 'Finish editing first'
                    : legacy
                      ? 'Imported documents are read-only'
                      : null
              }
              loading={versionsLoading}
            />
          </section>
        </aside>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Regenerate this document?"
        description={`A new version is written from the same options and current evidence. Version ${doc.currentVersion} stays in history, including your edits. Uses 1 generation.`}
        confirmLabel="Regenerate"
        loading={regenerate.isPending}
        onConfirm={() => {
          setConfirmRegen(false);
          doRegenerate();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${doc.title}”?`}
        description={`All ${plural(versionCount || 1, 'version')} are deleted. This can't be undone.`}
        confirmLabel="Delete document"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(id, {
            onSuccess: () => {
              toast.success(`Deleted “${doc.title}”`);
              setConfirmDelete(false);
              onDeleted();
            },
            onError: (e) =>
              toast.error(`Couldn't delete the document. ${errorMessage(e, 'the document')}`),
          });
        }}
      />
      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        documentId={id}
        title={doc.title}
        baseVersion={doc.currentVersion}
      />
      <Dialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A newer version exists (v{conflict})</DialogTitle>
            <DialogDescription>
              Someone — maybe you in another tab — saved this document. Reload it, or save yours as
              a new version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setConflict(null);
                setEditing(false);
                setSave('idle');
                window.location.reload();
              }}
            >
              Reload v{conflict}
            </Button>
            <Button
              onClick={() => {
                if (conflict !== null && draft !== null) persist(draft, conflict);
                setConflict(null);
              }}
            >
              Save mine as a new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ViewerSkeletonBody() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-10/12" />
    </div>
  );
}

function RegenerateMenu({
  doc,
  sections,
  labels,
  canSection,
  onWhole,
  onSection,
}: {
  doc: DocumentDetail['document'];
  sections: readonly string[];
  labels: Map<string, string>;
  canSection: boolean;
  onWhole: () => void;
  onSection: (key: string) => void;
}) {
  return (
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={onWhole}>
        <RotateCw aria-hidden="true" />
        Regenerate document
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href={`/documents/new/${doc.type}?regenerate=${doc.id}`}>
          <SlidersHorizontal aria-hidden="true" />
          Change options and regenerate
        </Link>
      </DropdownMenuItem>
      {canSection && sections.length ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Section</DropdownMenuLabel>
          {sections.map((key) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => {
                onSection(key);
              }}
            >
              {labels.get(key) ?? key}
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
    </DropdownMenuContent>
  );
}

function EvidencePanel({
  evidence,
  desktop,
  streaming,
}: {
  evidence: DocumentDetail['document']['evidence'];
  desktop: boolean;
  streaming: boolean;
}) {
  const list = evidence.length ? (
    <ul className="flex flex-col divide-y">
      {evidence.slice(0, 12).map((e) => (
        <li key={e.ref} className="flex flex-col gap-1 px-4 py-2.5">
          <span className="truncate text-base">{e.title}</span>
          <span>
            <EvidenceChip refId={e.ref} evidence={e} />
          </span>
        </li>
      ))}
      {evidence.length > 12 ? (
        <li className="px-4 py-2.5 text-caption text-subtle-foreground">
          and {evidence.length - 12} more
        </li>
      ) : null}
    </ul>
  ) : (
    <p className="px-4 py-3 text-base text-muted-foreground">
      {streaming
        ? 'Citations appear as sections are written.'
        : 'No evidence is cited in this version.'}
    </p>
  );
  const heading = (
    <>
      <span className="text-lg font-semibold">Evidence</span>
      <span className="text-caption text-subtle-foreground">{evidence.length} cited</span>
    </>
  );
  if (desktop) {
    return (
      <section className="rounded-md border bg-card" aria-labelledby="evidence-h">
        <h2 id="evidence-h" className="flex items-baseline justify-between border-b px-4 py-3">
          {heading}
        </h2>
        {list}
      </section>
    );
  }
  return (
    <details className="group rounded-md border bg-card">
      <summary className="flex cursor-pointer items-baseline justify-between px-4 py-3 group-open:border-b">
        <h2 className="contents">{heading}</h2>
      </summary>
      {list}
    </details>
  );
}
