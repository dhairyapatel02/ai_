'use client';

import { type EvidenceItem, type RenderSection } from '@devimpact/shared';
import { ArrowDown, ArrowUp, Check, Copy, Pin, PinOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { Citations, ClaimText } from './document-renderer';

export interface BulletActions {
  copy: (text: string) => void;
  togglePin: (index: number, pinned: boolean) => void;
  toggleUsed: (index: number, used: boolean) => void;
  move: (from: number, to: number) => void;
}

/**
 * Resume bullet cards (S16, task 6 — the rebuilt `ResumeBulletCard`): theme badge, the bullet with
 * its evidence, Copy, Pin (moves it up with the other pinned bullets), Mark as used, Move up/down.
 * Curation persists through `PATCH /documents/:id` content (`pinned` / `used`, D-027).
 */
export function ResumeBullets({
  section,
  byRef,
  actions,
}: {
  section: Extract<RenderSection, { kind: 'items' }>;
  byRef: Map<string, EvidenceItem>;
  /** null = read-only (streaming, older version, legacy). */
  actions: BulletActions | null;
}) {
  const last = section.items.length - 1;
  return (
    <ol className="flex flex-col gap-2" aria-label="Resume bullets">
      {section.items.map((item, i) => {
        const index = item.index ?? i;
        return (
          <li
            key={item.id ?? index}
            className={cn(
              'flex flex-col gap-2 rounded-sm border bg-card p-3',
              item.pinned && 'border-accent-foreground/30',
              item.used && 'bg-surface-2',
            )}
            data-testid="resume-bullet"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {item.theme ? <Badge variant="accent">{item.theme}</Badge> : null}
              {item.pinned ? (
                <Badge variant="outline">
                  <Pin aria-hidden="true" />
                  Pinned
                </Badge>
              ) : null}
              {item.used ? (
                <Badge variant="success">
                  <Check aria-hidden="true" />
                  Used
                </Badge>
              ) : null}
            </div>
            <p className={cn('text-md leading-relaxed', item.used && 'text-muted-foreground')}>
              <ClaimText item={item} cited={section.cited} />
              <Citations item={item} byRef={byRef} cited={section.cited} />
            </p>
            {actions ? (
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label={`Bullet ${i + 1} actions`}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    actions.copy(item.text);
                  }}
                >
                  <Copy aria-hidden="true" />
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={item.pinned}
                  onClick={() => {
                    actions.togglePin(index, !item.pinned);
                  }}
                >
                  {item.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                  {item.pinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={item.used}
                  onClick={() => {
                    actions.toggleUsed(index, !item.used);
                  }}
                >
                  <Check aria-hidden="true" />
                  {item.used ? 'Used' : 'Mark as used'}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move bullet ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => {
                    actions.move(index, index - 1);
                  }}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Move bullet ${i + 1} down`}
                  disabled={i === last}
                  onClick={() => {
                    actions.move(index, index + 1);
                  }}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
