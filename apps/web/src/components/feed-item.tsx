'use client';

import {
  Award,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

import { CATEGORY_LABEL, parseCategory } from '@/lib/achievements';
import { formatLocalDate, formatTime, localDateKey } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { ActivityType, FeedItem } from '@devimpact/shared';

/** Fixed icon meanings (DESIGN_SYSTEM §7). */
export const FEED_ICON: Record<ActivityType, LucideIcon> = {
  pr_merged: GitMerge,
  pr_opened: GitPullRequest,
  pr_closed: GitPullRequestClosed,
  review: MessageSquareText,
  commit: GitCommitHorizontal,
  achievement: Award,
};

export const FEED_VERB: Record<ActivityType, string> = {
  pr_merged: 'Merged',
  pr_opened: 'Opened',
  pr_closed: 'Closed',
  review: 'Reviewed',
  commit: 'Committed',
  achievement: 'Achievement',
};

const REVIEW_STATE: Record<string, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
  dismissed: 'dismissed',
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * `?item=` value for a feed row: `<type>:<rowId>`; reviews also carry the reviewed PR id
 * (`review:<reviewId>:<pullRequestId>`) because review details come from `GET /activity/prs/:id`.
 */
export function itemParam(item: FeedItem): string {
  if (item.type === 'review') {
    const prId = str(item.meta.pullRequestId);
    const id = str(item.meta.recordId) ?? item.id.split(':')[1] ?? '';
    return prId ? `review:${id}:${prId}` : item.id;
  }
  return item.id;
}

export interface ParsedItem {
  type: ActivityType;
  id: string;
  pullRequestId?: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseItemParam(value: string | null): ParsedItem | null {
  if (!value) return null;
  const [type, id, pr] = value.split(':');
  if (!type || !id || !ID.test(id) || (pr !== undefined && !ID.test(pr))) return null;
  if (!['pr_merged', 'pr_opened', 'pr_closed', 'review', 'commit', 'achievement'].includes(type)) {
    return null;
  }
  return { type: type as ActivityType, id, pullRequestId: pr };
}

export function feedMeta(item: FeedItem): string {
  const repo = item.repo?.fullName ?? '';
  if (item.type === 'review') {
    const author = str(item.meta.authorLogin);
    const state = REVIEW_STATE[str(item.meta.reviewState) ?? ''] ?? '';
    return [repo, author ? `by @${author}` : null, state || null].filter(Boolean).join(' · ');
  }
  if (item.type === 'achievement') {
    const category = parseCategory(str(item.meta.category));
    return category ? CATEGORY_LABEL[category] : 'Achievement';
  }
  return repo;
}

/** Feed time: 24-hour time for today, otherwise the date (`Nov 6`). */
export function feedTime(occurredAt: string, timezone: string | undefined, today: string | null) {
  const day = localDateKey(occurredAt, timezone);
  if (today && day === today) return formatTime(occurredAt, timezone);
  return formatLocalDate(day, { currentYear: today ? Number(today.slice(0, 4)) : undefined });
}

/** FeedItem (DESIGN_SYSTEM §5.2): icon by type, verb + title, repo/meta, time; opens the drawer. */
export function FeedItemRow({
  item,
  timezone,
  today,
  onOpen,
  className,
}: {
  item: FeedItem;
  timezone?: string;
  today: string | null;
  onOpen: (item: FeedItem) => void;
  className?: string;
}) {
  const Icon = FEED_ICON[item.type];
  return (
    <button
      type="button"
      onClick={() => {
        onOpen(item);
      }}
      className={cn(
        'flex w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2',
        className,
      )}
      data-testid="feed-item"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">
          <span className="text-muted-foreground">{FEED_VERB[item.type]}</span> {item.title}
        </span>
        <span className="truncate text-caption text-subtle-foreground">{feedMeta(item)}</span>
      </span>
      <span className="shrink-0 text-caption whitespace-nowrap text-subtle-foreground tabular-nums">
        {feedTime(item.occurredAt, timezone, today)}
      </span>
    </button>
  );
}
