'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { NAV_GROUPS } from './nav-config';
import { useShell } from './shell-context';

const GO_TO = new Map(
  NAV_GROUPS.flatMap((g) => g.items)
    .filter((item) => item.shortcut)
    .map((item) => [item.shortcut?.toLowerCase() ?? '', item.href]),
);

/** Typing in a field (or a content-editable) never triggers single-key shortcuts (WCAG 2.1.4). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable)
  );
}

/**
 * Global shortcuts (IA §5): ⌘K / Ctrl K palette · G then D/A/K/C/O · A add achievement ·
 * ? shortcut list · [ collapse sidebar. Single-key shortcuts can be turned off.
 */
export function useGlobalShortcuts() {
  const router = useRouter();
  const shell = useShell();
  const pendingG = useRef<number | null>(null);
  const shellRef = useRef(shell);
  useEffect(() => {
    shellRef.current = shell;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const s = shellRef.current;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || !s.singleKeyShortcuts) return;
      if (s.paletteOpen || s.periodOpen || s.navOpen || s.shortcutsOpen) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]'))
        return;

      const key = event.key.toLowerCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const href = GO_TO.get(key);
        if (href) {
          event.preventDefault();
          router.push(href);
        }
        return;
      }
      if (key === 'g') {
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 1200);
      } else if (event.key === '?') {
        event.preventDefault();
        s.setShortcutsOpen(true);
      } else if (key === 'a') {
        event.preventDefault();
        router.push('/achievements');
      } else if (event.key === '[') {
        event.preventDefault();
        s.toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [router]);
}

const SHORTCUTS: [keys: string[], label: string][] = [
  [['⌘', 'K'], 'Open the command palette (Ctrl K on Windows/Linux)'],
  [['G', 'D'], 'Go to Dashboard'],
  [['G', 'A'], 'Go to Activity'],
  [['G', 'K'], 'Go to KPIs'],
  [['G', 'C'], 'Go to Career'],
  [['G', 'O'], 'Go to Documents'],
  [['A'], 'Add achievement'],
  [['['], 'Collapse or expand the sidebar'],
  [['?'], 'Show keyboard shortcuts'],
  [['Esc'], 'Close a dialog, drawer or menu'],
];

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen, singleKeyShortcuts, setSingleKeyShortcuts } = useShell();
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts never fire while you type in a field.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col divide-y">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-base">{label}</dt>
              <dd className="flex shrink-0 gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-4 rounded-md bg-surface-2 p-3">
          <Label htmlFor="single-key-shortcuts" className="text-base font-normal">
            Single-key shortcuts (G, A, ?, [)
          </Label>
          <Switch
            id="single-key-shortcuts"
            checked={singleKeyShortcuts}
            onCheckedChange={setSingleKeyShortcuts}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
