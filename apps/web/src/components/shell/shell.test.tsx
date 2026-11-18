import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { syncRun, syncStatus } from '../../../test/fixtures';
import { hrefWithPeriod, isNavItemActive, routeMeta } from './nav-config';
import { NavLinks } from './nav-links';
import { isTypingTarget } from './shortcuts';
import { describeSync } from './sync-status';
import { nextTheme } from './theme-toggle';
import { initials } from './user-menu';

import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/kpis/impact',
  useSearchParams: () => new URLSearchParams('period=quarter:2026-Q3'),
  useRouter: () => ({ push: vi.fn() }),
}));

function withQuery(ui: ReactNode, seed: (qc: QueryClient) => void = () => undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  seed(qc);
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('navigation', () => {
  it('keeps the parent item active on child routes and carries ?period between Overview pages', () => {
    render(
      withQuery(<NavLinks />, (qc) => {
        qc.setQueryData(['sync', 'status', 'default'], syncStatus({ state: 'needs_reauth' }));
      }),
    );
    const kpis = screen.getByRole('link', { name: 'KPIs' });
    expect(kpis).toHaveAttribute('aria-current', 'page');
    expect(kpis).toHaveAttribute('href', '/kpis?period=quarter%3A2026-Q3');
    expect(screen.getByRole('link', { name: 'Career' })).toHaveAttribute('href', '/career');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('group', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Integrations.*needs attention/ })).toBeInTheDocument();
  });

  it('resolves titles, parents and period pages', () => {
    expect(routeMeta('/kpis/impact')).toMatchObject({
      title: 'Impact score',
      parent: { href: '/kpis' },
      period: true,
    });
    expect(routeMeta('/documents/cm123')).toMatchObject({ title: 'Document' });
    expect(routeMeta('/settings/profile').period).toBeUndefined();
    expect(isNavItemActive('/documents', '/documents/new/resume')).toBe(true);
    expect(hrefWithPeriod('/career', 'month:2026-10')).toBe('/career');
  });
});

describe('sync status copy', () => {
  it('covers every state of DESIGN_SYSTEM §5.2 SyncStatus', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(describeSync(null).text).toBe('Not connected');
    expect(describeSync(undefined, { loading: true }).text).toBe('Checking sync…');
    expect(describeSync(undefined, { error: true }).text).toBe('Status unavailable');
    expect(
      describeSync(syncStatus({ lastSuccessfulAt: '2026-11-18T11:48:00Z' }), { now }),
    ).toMatchObject({ tone: 'ok', text: 'Synced 12 min ago' });
    expect(
      describeSync(
        syncStatus({
          state: 'running',
          currentRun: syncRun({ progress: 64, recentWindowCompletedAt: '2026-11-18T11:00:00Z' }),
        }),
      ).text,
    ).toBe('Importing history · 64%');
    expect(describeSync(syncStatus({ state: 'queued' })).text).toBe('Sync queued');
    expect(describeSync(syncStatus({ state: 'failed' }))).toMatchObject({
      tone: 'danger',
      attention: true,
    });
  });
});

describe('shell helpers', () => {
  it('cycles the theme System → Light → Dark', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme(undefined)).toBe('light');
  });

  it('never fires single-key shortcuts while typing (WCAG 2.1.4)', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
  });

  it('derives avatar initials', () => {
    expect(initials('Priya Raman', undefined)).toBe('PR');
    expect(initials('', 'demo@devimpact.dev')).toBe('DE');
  });
});
