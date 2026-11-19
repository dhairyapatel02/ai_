'use client';

import { Copy, ExternalLink, GitMerge, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { parseItemParam, type ParsedItem } from '@/components/feed-item';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useHydrated } from '@/hooks/use-hydrated';
import { errorMessage, isApiError, quotaDetails } from '@/lib/api/errors';
import { useAchievementStatement, useCommit, usePullRequest } from '@/lib/api/metrics-hooks';
import { formatDate, formatTime, plural } from '@/lib/format';

import type {
  AchievementStatementResponse,
  PullRequestDetail,
  ReviewItem,
} from '@devimpact/shared';

const REVIEW_STATE: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  dismissed: 'Dismissed',
};

const CATEGORY: Record<string, string> = {
  delivery: 'Delivery',
  quality: 'Quality',
  mentoring: 'Mentoring',
  incident: 'Incident',
  leadership: 'Leadership',
  learning: 'Learning',
  collaboration: 'Collaboration',
  other: 'Other',
};

function hours(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} h`;
}

function Well({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface-2 p-3">
      <span className="text-caption text-subtle-foreground">{label}</span>
      <b className="font-semibold tabular-nums">{value}</b>
      {note ? <span className="text-caption text-subtle-foreground">{note}</span> : null}
    </div>
  );
}

function Ref({ children }: { children: string }) {
  return (
    <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
      {children}
    </span>
  );
}

function GitHubLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <Button variant="secondary" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden="true" />
        Open on GitHub
      </a>
    </Button>
  );
}

/**
 * "Turn into achievement" (S7, F-51): `POST /ai/achievement-statement` on the fast model (quick
 * quota). Saving achievements arrives with the Achievements page (P12, D-026): until then the
 * drafted statement is shown with a Copy button.
 */
function AchievementDraft({ source }: { source: { kind: 'pull_request' | 'commit'; id: string } }) {
  const draft = useAchievementStatement();
  const [result, setResult] = useState<AchievementStatementResponse | null>(null);
  const quota = isApiError(draft.error) ? quotaDetails(draft.error) : null;

  const run = () => {
    draft.mutate(source, {
      onSuccess: (data) => {
        setResult(data);
      },
    });
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-md border p-3"
      aria-labelledby="achievement-draft-title"
      aria-live="polite"
    >
      <h3 id="achievement-draft-title" className="font-medium">
        Capture this as an achievement
      </h3>
      {result ? (
        <div className="flex flex-col gap-2" data-testid="achievement-draft">
          <p className="font-medium">{result.title}</p>
          <p className="text-muted-foreground">{result.statement}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{CATEGORY[result.category] ?? result.category}</Badge>
            {result.citations.map((ref) => (
              <Ref key={ref}>{ref}</Ref>
            ))}
          </div>
          <p className="text-caption text-subtle-foreground">
            Saving achievements arrives with the Achievements page. Copy the statement to keep it
            for now.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(`${result.title}\n\n${result.statement}`).then(
                  () => toast.success('Statement copied'),
                  () => toast.error('Copy was blocked. Select the text and copy it manually.'),
                );
              }}
            >
              <Copy aria-hidden="true" />
              Copy statement
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            DevImpact drafts a short statement from this work. You review it before keeping it.
          </p>
          {draft.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {quota
                ? `Quick AI actions used up for this month — they reset on ${formatDate(quota.resetsAt, { withYear: false })}. Write it down manually for now.`
                : isApiError(draft.error) && draft.error.code === 'UPSTREAM_UNAVAILABLE'
                  ? 'The AI service is busy. Try again in a minute.'
                  : errorMessage(draft.error, 'the statement')}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            loading={draft.isPending}
            disabled={!!quota}
            onClick={run}
          >
            <Sparkles aria-hidden="true" />
            {draft.isPending ? 'Drafting…' : 'Turn into achievement'}
          </Button>
        </>
      )}
    </section>
  );
}

function Timeline({
  entries,
  timezone,
}: {
  entries: [string, string | null][];
  timezone?: string;
}) {
  const shown = entries.filter((e): e is [string, string] => e[1] !== null);
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby="timeline-title">
      <h3 id="timeline-title" className="font-medium">
        Timeline
      </h3>
      <ul className="flex flex-col text-sm">
        {shown.map(([label, at]) => (
          <li key={label} className="flex gap-3 py-1">
            <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
            <span className="tabular-nums">
              {formatDate(at, { timeZone: timezone })} · {formatTime(at, timezone)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrBody({ pr, timezone }: { pr: PullRequestDetail; timezone?: string }) {
  const lines = pr.additions !== null && pr.deletions !== null ? pr.additions + pr.deletions : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {pr.state === 'merged' ? (
          <Badge variant="accent">
            <GitMerge aria-hidden="true" />
            Merged
          </Badge>
        ) : pr.state === 'closed' ? (
          <Badge variant="neutral">Closed without merging</Badge>
        ) : (
          <Badge variant="neutral">{pr.isDraft ? 'Draft' : 'Open'}</Badge>
        )}
        {pr.reverted ? <Badge variant="warning">Reverted</Badge> : null}
        {pr.labels.map((l) => (
          <Badge key={l} variant="outline">
            {l}
          </Badge>
        ))}
        <Ref>{pr.ref}</Ref>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Well
          label="Cycle time"
          value={hours(pr.cycleTimeHours)}
          note="Ready → merged, business hours"
        />
        <Well
          label="First review after"
          value={hours(pr.firstReviewHours)}
          note="Your wait for a reviewer"
        />
        <Well
          label="Changed lines"
          value={
            pr.additions === null || pr.deletions === null
              ? '—'
              : `+${pr.additions} −${pr.deletions}`
          }
          note={
            lines === null
              ? 'Size not reported by GitHub'
              : `${pr.changedFiles !== null ? `${plural(pr.changedFiles, 'file')} · ` : ''}${lines <= 400 ? 'small PR' : 'larger than 400 lines'}`
          }
        />
        <Well
          label="Reviews"
          value={pr.approvalsCount === null ? '—' : plural(pr.approvalsCount, 'approval')}
          note={
            pr.changesRequestedCount
              ? plural(pr.changesRequestedCount, 'change request')
              : pr.changesRequestedCount === 0
                ? 'Approved on first pass'
                : undefined
          }
        />
      </div>
      <Timeline
        timezone={timezone}
        entries={[
          ['Opened', pr.createdAt],
          ['Ready for review', pr.readyAt !== pr.createdAt ? pr.readyAt : null],
          ['Merged', pr.mergedAt],
          ['Closed', pr.state === 'closed' ? pr.closedAt : null],
        ]}
      />
      {pr.isAuthoredByUser ? (
        <AchievementDraft source={{ kind: 'pull_request', id: pr.id }} />
      ) : null}
    </>
  );
}

function ReviewBody({
  pr,
  reviewId,
  timezone,
}: {
  pr: PullRequestDetail;
  reviewId: string;
  timezone?: string;
}) {
  const review: ReviewItem | undefined =
    pr.myReviews.find((r) => r.id === reviewId) ?? pr.myReviews.at(-1);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {review ? (
          <Badge variant="neutral">{REVIEW_STATE[review.state] ?? review.state}</Badge>
        ) : null}
        <Ref>{review?.ref ?? pr.ref}</Ref>
      </div>
      {review ? (
        <div className="grid grid-cols-2 gap-2">
          <Well
            label="Turnaround"
            value={
              review.turnaroundHours === null
                ? 'No request recorded'
                : hours(review.turnaroundHours)
            }
            note="Requested → your first review"
          />
          <Well
            label="Comments"
            value={review.commentsCount + (review.hasBody ? 1 : 0)}
            note="Including the review summary"
          />
        </div>
      ) : null}
      {review ? (
        <Timeline timezone={timezone} entries={[['Reviewed', review.submittedAt]]} />
      ) : null}
      <p className="text-sm text-muted-foreground">
        DevImpact stores review metadata only. The body of someone else&apos;s pull request is never
        stored.
      </p>
    </>
  );
}

function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4" aria-busy="true">
      <Skeleton className="h-5 w-2/3" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-24" />
      <span className="sr-only">Loading details…</span>
    </div>
  );
}

function PrDrawerContent({ item, timezone }: { item: ParsedItem; timezone?: string }) {
  const prId = item.type === 'review' ? (item.pullRequestId ?? null) : item.id;
  const pr = usePullRequest(prId);
  if (pr.isPending) return <DrawerSkeleton />;
  if (pr.isError) {
    return (
      <ErrorState
        error={pr.error}
        what="this pull request"
        headingLevel={3}
        onRetry={() => void pr.refetch()}
      />
    );
  }
  const isReview = item.type === 'review';
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetDescription>
          {pr.data.repo.fullName} ·{' '}
          {isReview
            ? `Review of #${pr.data.number}${pr.data.authorLogin ? ` by @${pr.data.authorLogin}` : ''}`
            : `Pull request #${pr.data.number}`}
        </SheetDescription>
        <SheetTitle className="text-lg">{pr.data.title}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
        {isReview ? (
          <ReviewBody pr={pr.data} reviewId={item.id} timezone={timezone} />
        ) : (
          <PrBody pr={pr.data} timezone={timezone} />
        )}
      </div>
      <div className="border-t p-4">
        <GitHubLink url={pr.data.url} />
      </div>
    </>
  );
}

function CommitDrawerContent({ id, timezone }: { id: string; timezone?: string }) {
  const commit = useCommit(id);
  if (commit.isPending) return <DrawerSkeleton />;
  if (commit.isError) {
    return (
      <ErrorState
        error={commit.error}
        what="this commit"
        headingLevel={3}
        onRetry={() => void commit.refetch()}
      />
    );
  }
  const c = commit.data;
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetDescription>{c.repo.fullName} · Commit</SheetDescription>
        <SheetTitle className="text-lg">{c.messageHeadline}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Ref>{c.ref}</Ref>
          {c.associatedPrNumber ? (
            <span className="text-caption text-subtle-foreground">
              in PR #{c.associatedPrNumber}
            </span>
          ) : null}
        </div>
        <Well
          label="Authored"
          value={`${formatDate(c.authoredAt, { timeZone: timezone })} · ${formatTime(c.authoredAt, timezone)}`}
          note={`+${c.additions} −${c.deletions} (context only — never a KPI)`}
        />
        {c.messageBody ? (
          <p className="text-sm whitespace-pre-line text-muted-foreground">{c.messageBody}</p>
        ) : null}
        <AchievementDraft source={{ kind: 'commit', id: c.id }} />
      </div>
      <div className="border-t p-4">
        <GitHubLink url={c.url} />
      </div>
    </>
  );
}

/**
 * ItemDrawer (DESIGN_SYSTEM §5.2, S7): PR / review / commit detail in a right sheet (full screen on
 * phones), opened from `?item=` so it can be linked and Back closes it.
 */
export function ItemDrawer({
  value,
  onClose,
  timezone,
}: {
  value: string | null;
  onClose: () => void;
  timezone?: string;
}) {
  const item = parseItemParam(value);
  // Deep links open the sheet only after hydration (Radix marks siblings aria-hidden on open).
  const hydrated = useHydrated();
  return (
    <Sheet
      open={hydrated && item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md" data-testid="item-drawer">
        {item === null ? (
          <SheetTitle className="sr-only">Details</SheetTitle>
        ) : item.type === 'commit' ? (
          <CommitDrawerContent id={item.id} timezone={timezone} />
        ) : item.type === 'achievement' ? (
          <SheetHeader>
            <SheetTitle>Achievement</SheetTitle>
            <SheetDescription>Achievements arrive with the Achievements page.</SheetDescription>
          </SheetHeader>
        ) : (
          <PrDrawerContent item={item} timezone={timezone} />
        )}
      </SheetContent>
    </Sheet>
  );
}
