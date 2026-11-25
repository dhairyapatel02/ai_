'use client';

import {
  PROVIDER_LABELS,
  type AchievementStatementResponse,
  type IssueDetail,
  type ProviderWire,
  type PullRequestDetail,
  type ReviewItem,
} from '@devimpact/shared';
import { ExternalLink, GitMerge, Plus, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AchievementDialog } from '@/components/career/achievement-dialog';
import { EvidenceChip } from '@/components/evidence-chip';
import { parseItemParam, type ParsedItem } from '@/components/feed-item';
import { useShell } from '@/components/shell/shell-context';
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
import { useAchievement } from '@/lib/api/career-hooks';
import { errorMessage, isApiError, quotaDetails } from '@/lib/api/errors';
import { useAchievementStatement, useCommit, usePullRequest } from '@/lib/api/metrics-hooks';
import { useIssue } from '@/lib/api/provider-hooks';
import { formatDate, formatLocalDate, formatTime, localDateKey, plural } from '@/lib/format';


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

function GitHubLink({ url, provider = 'github' }: { url: string | null; provider?: ProviderWire }) {
  if (!url) return null;
  return (
    <Button variant="secondary" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden="true" />
        Open on {PROVIDER_LABELS[provider]}
      </a>
    </Button>
  );
}

const ISSUE_STATUS: Record<
  IssueDetail['status'],
  { text: string; variant: 'success' | 'accent' | 'neutral' }
> = {
  done: { text: 'Done', variant: 'success' },
  in_progress: { text: 'In progress', variant: 'accent' },
  todo: { text: 'To do', variant: 'neutral' },
  cancelled: { text: 'Cancelled', variant: 'neutral' },
};

/** Jira / Linear issue (P13): status, points, cycle time — titles only, never descriptions. */
function IssueDrawerContent({ id, timezone }: { id: string; timezone?: string }) {
  const issue = useIssue(id);
  if (issue.isPending) return <DrawerSkeleton />;
  if (issue.isError) {
    return (
      <ErrorState
        error={issue.error}
        what="this issue"
        headingLevel={3}
        onRetry={() => void issue.refetch()}
      />
    );
  }
  const i = issue.data;
  const label = PROVIDER_LABELS[i.provider];
  const status = ISSUE_STATUS[i.status];
  return (
    <>
      <SheetHeader className="pr-12">
        <SheetDescription>
          {[i.project.name, label, 'Issue'].filter(Boolean).join(' · ')}
        </SheetDescription>
        <SheetTitle className="text-lg">{i.title}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Ref>{i.ref}</Ref>
          <Badge variant={status.variant}>{i.statusName ?? status.text}</Badge>
          {i.cycleName ? <Badge variant="neutral">{i.cycleName}</Badge> : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Well
            label="Story points"
            value={i.storyPoints ?? '—'}
            note={i.storyPoints === null ? 'No estimate' : 'Team-specific size'}
          />
          <Well
            label="Cycle time"
            value={hours(i.cycleTimeHours)}
            note={i.startedAt ? 'Started → completed, business hours' : 'Never started'}
          />
          <Well
            label={i.completedAt ? 'Completed' : 'Updated'}
            value={formatDate(i.completedAt ?? i.updatedAt, { timeZone: timezone })}
          />
          <Well
            label="Priority"
            value={i.priority === 'none' ? '—' : i.priority.replace(/^./, (c) => c.toUpperCase())}
          />
        </div>
        {i.labels.length ? (
          <div className="flex flex-wrap gap-1.5">
            {i.labels.map((l) => (
              <Badge key={l} variant="neutral">
                {l}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="border-t p-4">
        <GitHubLink url={i.url} provider={i.provider} />
      </div>
    </>
  );
}

/**
 * "Turn into achievement" (S7, F-51, FLOWS F7): `POST /ai/achievement-statement` on the fast model
 * (quick quota) drafts a title, statement and category, then the S17 dialog opens pre-filled
 * ("Drafted by AI from <ref>. Edit anything before saving."). 402 → "Quick AI actions used up —
 * add it manually" with the dialog pre-filled from the record itself.
 */
function AchievementDraft({
  source,
  record,
}: {
  source: { kind: 'pull_request' | 'commit'; id: string };
  record: { ref: string; title: string; date: string };
}) {
  const draft = useAchievementStatement();
  const shell = useShell();
  const quota = isApiError(draft.error) ? quotaDetails(draft.error) : null;
  const evidence = [{ kind: source.kind, id: source.id, ref: record.ref, title: record.title }];

  const manual = () => {
    shell.openAchievement({
      title: record.title.slice(0, 200),
      occurredOn: record.date,
      evidence,
      source: 'from_activity',
    });
  };
  const run = () => {
    draft.mutate(source, {
      onSuccess: (data: AchievementStatementResponse) => {
        shell.openAchievement({
          title: data.title,
          category: data.category,
          impact: data.statement,
          occurredOn: record.date,
          evidence,
          source: 'from_activity',
          draftedFrom: record.ref,
        });
      },
    });
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-md bg-surface-2 p-3"
      aria-labelledby="achievement-draft-title"
    >
      <h3 id="achievement-draft-title" className="font-medium">
        Capture this as an achievement
      </h3>
      <p className="text-sm text-muted-foreground">
        DevImpact drafts a short statement from this work. You review and edit it before saving.
      </p>
      {draft.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {quota
            ? `Quick AI actions used up — add it manually. They reset on ${formatDate(quota.resetsAt, { withYear: false })}.`
            : isApiError(draft.error) && draft.error.code === 'UPSTREAM_UNAVAILABLE'
              ? 'The AI service is busy. Try again in a minute, or add it manually.'
              : errorMessage(draft.error, 'the statement')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {quota ? (
          <Button size="sm" variant="secondary" onClick={manual}>
            <Plus aria-hidden="true" />
            Add it manually
          </Button>
        ) : (
          <Button size="sm" variant="secondary" loading={draft.isPending} onClick={run}>
            <Sparkles aria-hidden="true" />
            {draft.isPending ? 'Drafting…' : 'Turn into achievement'}
          </Button>
        )}
        {draft.isError && !quota ? (
          <Button size="sm" variant="ghost" onClick={manual}>
            Add it manually
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Achievement detail (S7 drawer): description, impact, evidence chips, links, Edit. */
function AchievementDrawerContent({ id }: { id: string }) {
  const q = useAchievement(id);
  const [editing, setEditing] = useState(false);
  if (q.isPending) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Achievement</SheetTitle>
          <SheetDescription className="sr-only">Loading</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>Achievement</SheetTitle>
          <SheetDescription className="sr-only">Error</SheetDescription>
        </SheetHeader>
        <ErrorState error={q.error} what="this achievement" onRetry={() => void q.refetch()} />
      </>
    );
  }
  const a = q.data;
  return (
    <>
      <SheetHeader>
        <SheetDescription>
          Achievement · {CATEGORY[a.category] ?? a.category} ·{' '}
          {formatLocalDate(a.occurredOn, { withYear: true })}
        </SheetDescription>
        <SheetTitle className="pr-8 text-lg">{a.title}</SheetTitle>
      </SheetHeader>
      <div
        className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
        data-testid="achievement-drawer"
      >
        {a.description ? <p className="whitespace-pre-line">{a.description}</p> : null}
        {a.impact ? (
          <Well label="Impact" value={<span className="font-normal">{a.impact}</span>} />
        ) : null}
        <section className="flex flex-col gap-1.5" aria-labelledby="ach-evidence-title">
          <h3 id="ach-evidence-title" className="font-medium">
            Linked evidence
          </h3>
          {a.evidence.length ? (
            <div className="flex flex-wrap gap-1.5">
              {a.evidence.map((e) => (
                <EvidenceChip key={e.ref} refId={e.ref} evidence={e} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No pull requests, reviews or commits linked.
            </p>
          )}
        </section>
        {a.links.length ? (
          <ul className="flex flex-col gap-1">
            {a.links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-link underline underline-offset-2"
                >
                  {l.label || l.url}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="font-mono text-caption text-subtle-foreground">{a.ref}</p>
      </div>
      <div className="border-t p-4">
        <Button
          variant="secondary"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </Button>
      </div>
      <AchievementDialog open={editing} onOpenChange={setEditing} editing={a} />
    </>
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
        <AchievementDraft
          source={{ kind: 'pull_request', id: pr.id }}
          record={{
            ref: pr.ref,
            title: pr.title,
            date: localDateKey(pr.mergedAt ?? pr.createdAt, timezone),
          }}
        />
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
        <GitHubLink url={pr.data.url} provider={pr.data.repo.provider} />
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
        <AchievementDraft
          source={{ kind: 'commit', id: c.id }}
          record={{
            ref: c.ref,
            title: c.messageHeadline,
            date: localDateKey(c.authoredAt, timezone),
          }}
        />
      </div>
      <div className="border-t p-4">
        <GitHubLink url={c.url} provider={c.repo.provider} />
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
          <AchievementDrawerContent id={item.id} />
        ) : item.type === 'issue' ? (
          <IssueDrawerContent id={item.id} timezone={timezone} />
        ) : (
          <PrDrawerContent item={item} timezone={timezone} />
        )}
      </SheetContent>
    </Sheet>
  );
}
