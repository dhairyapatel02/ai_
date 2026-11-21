import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, Suspense, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadStreamOptions, SseMessage } from '@/lib/api/event-stream';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../../test/api-mock';
import { clone, fx11, NOW } from '../../../../../test/fixtures-p11';
import { nav, setUrl } from '../../../../../test/navigation-mock';
import { DocumentView } from './document-view';

vi.mock(
  '@/lib/api/browser',
  async () => (await import('../../../../../test/api-mock')).browserModule,
);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../../test/navigation-mock')).navigationModule,
);
// next/dynamic → React.lazy, so the editor really loads in edit mode.
vi.mock('next/dynamic', () => ({
  default: (load: () => Promise<{ default: ComponentType<object> }>) => {
    const Lazy = lazy(load);
    return function Dynamic(props: object) {
      return (
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      );
    };
  },
}));
const stream = vi.hoisted(() => ({
  impl: null as null | ((o: ReadStreamOptions) => Promise<void>),
}));
vi.mock('@/lib/api/event-stream', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/event-stream')>()),
  readEventStream: (o: ReadStreamOptions) =>
    stream.impl ? stream.impl(o) : new Promise<void>(() => undefined),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const A = fx11.appraisal.data.document;
const msg = (id: string, event: string, data: unknown): SseMessage => ({
  id,
  event,
  data: JSON.stringify(data),
});

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx11.me,
    'GET /documents': { data: [], meta: { nextCursor: null, hasMore: false } },
    [`GET /documents/${A.id}`]: (q) => (q?.version === 1 ? fx11.appraisalV1 : fx11.appraisal),
    [`GET /documents/${A.id}/versions`]: fx11.versions,
    ...overrides,
  });
}

function edited(version: number) {
  const d = clone(fx11.appraisal.data);
  d.document.currentVersion = version;
  d.version = d.version ? { ...d.version, number: version, source: 'user_edit' } : null;
  return d;
}

describe('DocumentView (S16)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    calls.length = 0;
    stream.impl = null;
    // jsdom can't navigate: the download link click is a no-op here.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    setUrl(`/documents/${A.id}`);
    Object.values(toast).forEach((f) => f.mockClear());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loading: title and section skeletons', () => {
    routes({ [`GET /documents/${A.id}`]: pending });
    renderWithQuery(<DocumentView id={A.id} />);
    expect(screen.getByText('Loading the document…')).toBeInTheDocument();
  });

  it('success: ordered sections, engine table, coverage, flags banner and versions', async () => {
    routes();
    renderWithQuery(<DocumentView id={A.id} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Appraisal · H1 2026' }),
    ).toBeInTheDocument();
    const body = screen.getByTestId('document-body');
    const headings = within(body)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      'Executive summary',
      'Key contributions',
      'MetricsEngine',
      'Areas of impact',
      'Growth',
      'Next goals',
    ]);
    expect(
      screen.getByText('Calculated by DevImpact from your GitHub data — not written by AI.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('coverage-badge')).toHaveTextContent('92% of claims cited');
    expect(screen.getByText('1 claim has no evidence')).toBeInTheDocument();
    expect(screen.getByText('No evidence linked')).toBeInTheDocument();
    expect(
      screen.getByText('Regularly unblocked the platform team during on-call handovers.'),
    ).toHaveAttribute('data-flagged', 'true');
    const versions = await screen.findByTestId('version-list');
    expect(within(versions).getByText('v3 · current')).toBeInTheDocument();
    expect(within(versions).getByText(/Your edits/)).toBeInTheDocument();
    expect(within(versions).getByRole('button', { name: 'Restore v1' })).toBeInTheDocument();
  });

  it('citation popover: title, repository, date and a GitHub link', async () => {
    routes();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    const ev = A.evidence[0];
    if (!ev) throw new Error('fixture has no evidence');
    const chips = await screen.findAllByRole('button', { name: `Evidence ${ev.ref}` });
    await user.click(chips[0]);
    const pop = await screen.findByRole('dialog', { name: 'Evidence' });
    expect(within(pop).getByText(ev.title)).toBeInTheDocument();
    expect(
      within(pop).getByText(new RegExp(`Pull request · ${ev.repo ?? ''}`)),
    ).toBeInTheDocument();
    expect(within(pop).getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', ev.url);
    expect(within(pop).getByRole('link', { name: 'Details' })).toHaveAttribute(
      'href',
      `/activity?item=pr_merged:${ev.id}`,
    );
  });

  it('legacy imports render readable sections, read-only, never raw JSON', async () => {
    const L = fx11.legacy.data.document;
    routes({
      [`GET /documents/${L.id}`]: fx11.legacy,
      [`GET /documents/${L.id}/versions`]: { data: [], meta: { nextCursor: null, hasMore: false } },
    });
    renderWithQuery(<DocumentView id={L.id} />);
    expect(await screen.findByText('Imported from DevImpact v0.1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Executive summary' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Pr count' })).toBeInTheDocument();
    expect(screen.getByTestId('document-body').textContent).not.toContain('{');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('404: "This document was deleted" with a way back', async () => {
    routes({ [`GET /documents/${A.id}`]: fail(404, 'NOT_FOUND') });
    renderWithQuery(<DocumentView id={A.id} />);
    expect(
      await screen.findByRole('heading', { name: 'This document was deleted' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to documents' })).toHaveAttribute(
      'href',
      '/documents',
    );
  });

  it('editor: autosave 900 ms after typing → "Saved · v4"', async () => {
    let body: {
      baseVersion: number;
      content: { sections: { executiveSummary: { text: string } } };
    } | null = null;
    routes({
      [`PATCH /documents/${A.id}`]: (_q, b) => {
        body = b as typeof body;
        return edited(4);
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText('Executive summary');
    await user.type(field, ' More.');
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saving…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => {
      expect(screen.getByTestId('save-status')).toHaveTextContent('Saved · v4');
    });
    expect(body).not.toBeNull();
    const sent = body as unknown as {
      baseVersion: number;
      content: { sections: { executiveSummary: { text: string } } };
    };
    expect(sent.baseVersion).toBe(3);
    expect(sent.content.sections.executiveSummary.text).toMatch(/ More\.$/);
    // Engine sections are read-only in edit mode.
    expect(
      screen.getByText('Calculated by DevImpact — read-only while editing.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(toast.success).toHaveBeenCalledWith('Saved as v4');
  });

  it('editor: 409 VERSION_CONFLICT opens the conflict dialog; saving mine uses the newer base', async () => {
    const bases: number[] = [];
    routes({
      [`PATCH /documents/${A.id}`]: (_q, b) => {
        const base = (b as { baseVersion: number }).baseVersion;
        bases.push(base);
        if (base === 3) return fail(409, 'VERSION_CONFLICT', { currentVersion: 5 })(_q, b);
        return edited(6);
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.type(await screen.findByLabelText('Executive summary'), '!');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(
      await screen.findByRole('heading', { name: 'A newer version exists (v5)' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save mine as a new version' }));
    await waitFor(() => {
      expect(bases).toEqual([3, 5]);
    });
  });

  it('editor: empty claims are not saved', async () => {
    routes();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(await screen.findByLabelText('Executive summary'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('save-status')).toHaveTextContent('Fill in empty claims to save');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('versions: view an older version from the URL and restore it', async () => {
    setUrl(`/documents/${A.id}?version=1`);
    routes({
      [`POST /documents/${A.id}/versions/1/restore`]: edited(4),
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    expect(await screen.findByText("You're viewing v1")).toBeInTheDocument();
    expect(
      await screen.findByText('In this half I focused on the reliability of our payment flows.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore this version' }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Restored v1 as v4');
    });
    expect(nav.replace).toHaveBeenCalledWith(`/documents/${A.id}`, { scroll: false });
  });

  it('export: downloads PDF / DOCX / Markdown and copies Markdown / plain text', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    routes({
      [`GET /documents/${A.id}/export`]: (q) => {
        urls.push(String(q?.format));
        return { blob: new Blob(['x']), filename: `appraisal-2026-H1-v3.${String(q?.format)}` };
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    for (const [item, format] of [
      ['Download PDF', 'pdf'],
      ['Download DOCX', 'docx'],
      ['Download Markdown', 'md'],
    ] as const) {
      await user.click(await screen.findByRole('button', { name: 'Export' }));
      await user.click(await screen.findByRole('menuitem', { name: item }));
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(`Downloaded appraisal-2026-H1-v3.${format}`);
      });
    }
    expect(urls).toEqual(['pdf', 'docx', 'md']);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy as Markdown' }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Copied as Markdown');
    });
    const md = await navigator.clipboard.readText();
    expect(md).toMatch(/^# Appraisal · H1 2026\n/);
    expect(md).toContain('## Key contributions');
    expect(md).toContain('[^1]:');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy as plain text' }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Copied as plain text');
    });
    expect(await navigator.clipboard.readText()).toContain('EXECUTIVE SUMMARY');
  });

  it('export failure: toast with Try again', async () => {
    routes({ [`GET /documents/${A.id}/export`]: fail(500, 'INTERNAL') });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await user.click(await screen.findByRole('button', { name: 'Export' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download PDF' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/^Couldn't export the document\./),
        expect.objectContaining({
          action: expect.objectContaining({ label: 'Try again' }) as unknown,
        }),
      );
    });
  });

  it('streaming: sections appear, status names the section, one live announcement, Stop cancels', async () => {
    const pendingDoc = clone(fx11.appraisal);
    pendingDoc.data.document.status = 'streaming';
    pendingDoc.data.document.currentVersion = 0;
    pendingDoc.data.version = null;
    pendingDoc.data.document.evidence = [];
    let emit: ((m: SseMessage) => void) | null = null;
    stream.impl = (o) =>
      new Promise<void>(() => {
        emit = o.onMessage;
      });
    routes({
      [`GET /documents/${A.id}`]: pendingDoc,
      [`GET /documents/${A.id}/versions`]: { data: [], meta: { nextCursor: null, hasMore: false } },
      [`POST /documents/${A.id}/cancel`]: { document: { ...A, status: 'cancelled' } },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await waitFor(() => {
      expect(emit).not.toBeNull();
    });
    act(() => {
      emit?.(msg('1-0', 'status', { status: 'streaming', version: 1 }));
      emit?.(msg('2-0', 'delta', { key: 'executiveSummary', text: 'This half I' }));
    });
    expect(
      await screen.findByText('Writing section 1 of 5 · Executive summary'),
    ).toBeInTheDocument();
    expect(screen.getByText('This half I')).toBeInTheDocument();
    expect(screen.getByTestId('live-region')).toHaveTextContent('Writing section 1 of 5');
    act(() => {
      emit?.(
        msg('3-0', 'section', {
          key: 'executiveSummary',
          index: 0,
          content: {
            text: 'This half I focused on reliability.',
            citations: ['PR-acme/payments-api#248'],
          },
        }),
      );
      emit?.(msg('4-0', 'delta', { key: 'keyContributions', text: 'Shipped' }));
    });
    expect(
      await screen.findByText('Writing section 2 of 5 · Key contributions'),
    ).toBeInTheDocument();
    expect(screen.getByText('This half I focused on reliability.')).toBeInTheDocument();
    expect(screen.getByTestId('live-region')).toHaveTextContent('Writing section 2 of 5');
    // Actions wait for the draft; the body itself is not a live region.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByTestId('document-body').closest('[aria-live]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'Generation stopped. Nothing was counted against your quota.',
      );
    });
    expect(calls.some((c) => c.path === `/documents/${A.id}/cancel`)).toBe(true);
  });

  it('streaming done: refetches, toasts "Appraisal ready — 96% of claims cited." and announces it', async () => {
    const pendingDoc = clone(fx11.appraisal);
    pendingDoc.data.document.status = 'pending';
    let status: 'pending' | 'ready' = 'pending';
    stream.impl = (o) => {
      o.onMessage(msg('1-0', 'status', { status: 'streaming', version: 4 }));
      status = 'ready';
      o.onMessage(
        msg('2-0', 'done', {
          documentId: A.id,
          version: 4,
          citationCoverage: 0.96,
          flags: { uncited: 0, invalid: 0 },
        }),
      );
      return Promise.resolve();
    };
    routes({
      [`GET /documents/${A.id}`]: () => (status === 'pending' ? pendingDoc : fx11.appraisal),
    });
    renderWithQuery(<DocumentView id={A.id} />);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Appraisal ready — 96% of claims cited.');
    });
    expect(screen.getByTestId('live-region')).toHaveTextContent(
      'Appraisal ready, 96% of claims cited',
    );
    expect(await screen.findByTestId('coverage-badge')).toBeInTheDocument();
  });

  it('failed generation: danger banner (nothing counted) and Try again regenerates', async () => {
    const failed = clone(fx11.appraisal);
    failed.data.document.status = 'failed';
    failed.data.document.errorCode = 'UPSTREAM_UNAVAILABLE';
    routes({
      [`GET /documents/${A.id}`]: failed,
      [`POST /documents/${A.id}/regenerate`]: {
        document: { ...A, status: 'pending' },
        streamUrl: 's',
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    expect(await screen.findByText("The draft couldn't be finished")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was counted against your quota\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith('/regenerate'))?.body).toEqual({});
    });
  });

  it('regenerate: whole document asks for confirmation; one section regenerates directly', async () => {
    routes({
      [`POST /documents/${A.id}/regenerate`]: {
        document: { ...A, status: 'pending' },
        streamUrl: 's',
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));
    expect(screen.getByRole('menuitem', { name: 'Change options and regenerate' })).toHaveAttribute(
      'href',
      `/documents/new/appraisal?regenerate=${A.id}`,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Growth' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith('/regenerate'))?.body).toEqual({
        section: 'growth',
      });
    });
    expect(toast.info).toHaveBeenCalledWith('Rewriting “Growth”… saved as v4.');

    calls.length = 0;
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Regenerate document' }));
    expect(
      await screen.findByRole('heading', { name: 'Regenerate this document?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Version 3 stays in history, including your edits\. Uses 1 generation\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith('/regenerate'))?.body).toEqual({});
    });
  });

  it('delete: confirmation, DELETE, back to the library', async () => {
    routes({ [`DELETE /documents/${A.id}`]: { deleted: true } });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={A.id} />);
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete document' }));
    expect(
      await screen.findByText(/All 3 versions are deleted\. This can't be undone\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete document' }));
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith('/documents');
    });
    expect(toast.success).toHaveBeenCalledWith('Deleted “Appraisal · H1 2026”');
  });

  it('resume bullet cards: copy, pin (moves up), mark as used and reorder persist through PATCH', async () => {
    const R = fx11.resume.data.document;
    const bodies: { content: { bullets: { id: string; pinned?: boolean; used?: boolean }[] } }[] =
      [];
    routes({
      [`GET /documents/${R.id}`]: fx11.resume,
      [`GET /documents/${R.id}/versions`]: { data: [], meta: { nextCursor: null, hasMore: false } },
      [`PATCH /documents/${R.id}`]: (_q, b) => {
        bodies.push(b as (typeof bodies)[number]);
        return fx11.resume.data;
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentView id={R.id} />);
    const cards = await screen.findAllByTestId('resume-bullet');
    expect(cards).toHaveLength(6);
    expect(within(cards[0]).getByText('Pinned')).toBeInTheDocument();
    expect(
      within(cards[2]).getByText('Used', { selector: '[data-slot=badge]' }),
    ).toBeInTheDocument();

    await user.click(within(cards[1]).getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Copied bullet');
    });

    await user.click(within(cards[3]).getByRole('button', { name: 'Pin' }));
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]?.content.bullets.map((b) => b.id)).toEqual([
      'b1',
      'b4',
      'b2',
      'b3',
      'b5',
      'b6',
    ]);
    expect(bodies[0]?.content.bullets[1]?.pinned).toBe(true);

    await user.click(within(cards[4]).getByRole('button', { name: 'Mark as used' }));
    await waitFor(() => {
      expect(bodies).toHaveLength(2);
    });
    expect(bodies[1]?.content.bullets[4]).toMatchObject({ id: 'b5', used: true });

    await user.click(within(cards[5]).getByRole('button', { name: 'Move bullet 6 up' }));
    await waitFor(() => {
      expect(bodies).toHaveLength(3);
    });
    expect(bodies[2]?.content.bullets.map((b) => b.id)).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
      'b6',
      'b5',
    ]);
  });
});
