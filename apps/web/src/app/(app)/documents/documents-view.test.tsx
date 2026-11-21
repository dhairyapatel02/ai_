import { QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../test/api-mock';
import { clone, fx11 } from '../../../../test/fixtures-p11';
import { nav, setUrl } from '../../../../test/navigation-mock';
import { DocumentsView } from './documents-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);
const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
);
vi.mock('sonner', () => ({ toast }));

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx11.me,
    'GET /documents': fx11.documents,
    'GET /me/usage': fx11.usage,
    ...overrides,
  });
}

describe('DocumentsView (S11)', () => {
  beforeEach(() => {
    setUrl('/documents');
    calls.length = 0;
    toast.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading: skeleton rows', () => {
    routes({ 'GET /documents': pending });
    renderWithQuery(<DocumentsView />);
    expect(screen.getByText('Loading your documents…')).toBeInTheDocument();
  });

  it('success: rows with type, period, version, evidence, uncited badge and the usage meter', async () => {
    routes();
    renderWithQuery(<DocumentsView />);
    const rows = await screen.findAllByTestId('document-row');
    expect(rows).toHaveLength(6);
    const appraisal = rows.find((r) => within(r).queryByText(/^Appraisal · H1 2026$/));
    expect(appraisal).toBeDefined();
    expect(within(appraisal!).getByText('1 uncited')).toBeInTheDocument();
    expect(within(appraisal!).getByText('v3')).toBeInTheDocument();
    expect(within(appraisal!).getByText('92% cited')).toBeInTheDocument();
    expect(screen.getByText('6 documents · drafts are saved automatically')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: /AI document generations: 0 of 150 used/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Resets December 1 \(UTC\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Resume (imported)' })[0]).toHaveAttribute(
      'href',
      `/documents/${fx11.documents.data.find((d) => d.title === 'Resume (imported)')?.id ?? ''}`,
    );
  });

  it('filters by type chip and search via the URL, and sends them to the API', async () => {
    routes();
    const user = userEvent.setup();
    const { rerender, client } = renderWithQuery(<DocumentsView />);
    await screen.findAllByTestId('document-row');
    await user.click(screen.getByRole('button', { name: 'Appraisals' }));
    expect(nav.replace).toHaveBeenCalledWith('/documents?type=appraisal', { scroll: false });
    rerender(
      <QueryClientProvider client={client}>
        <DocumentsView />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(calls.some((c) => c.path === '/documents' && c.query?.type === 'appraisal')).toBe(
        true,
      );
    });
    expect(screen.getByRole('button', { name: 'Appraisals' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('empty: no documents, no match, and not connected', async () => {
    routes({
      'GET /documents': { data: [], meta: { nextCursor: null, hasMore: false, total: 0 } },
    });
    const first = renderWithQuery(<DocumentsView />);
    expect(await screen.findByRole('heading', { name: 'No documents yet' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Draft an appraisal, promotion packet or resume bullets. Every claim links to the work behind it.',
      ),
    ).toBeInTheDocument();
    first.unmount();

    setUrl('/documents?q=zzz');
    const second = renderWithQuery(<DocumentsView />);
    expect(await screen.findByRole('heading', { name: 'No documents match' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(nav.replace).toHaveBeenCalledWith('/documents', { scroll: false });
    second.unmount();

    setUrl('/documents');
    const me = clone(fx11.me);
    me.data.integrations = [];
    routes({
      'GET /me': me,
      'GET /documents': { data: [], meta: { nextCursor: null, hasMore: false, total: 0 } },
    });
    renderWithQuery(<DocumentsView />);
    expect(
      await screen.findByText(
        'Connect GitHub first — documents are written from your real pull requests and reviews.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect GitHub' })).toHaveAttribute(
      'href',
      '/onboarding/connect',
    );
  });

  it('partial: Writing / Failed badges; error: panel with retry', async () => {
    const docs = clone(fx11.documents);
    const [a, b] = docs.data;
    if (a) a.status = 'streaming';
    if (b) b.status = 'failed';
    routes({ 'GET /documents': docs });
    const view = renderWithQuery(<DocumentsView />);
    expect(await screen.findByText('Writing')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    view.unmount();

    routes({ 'GET /documents': fail(503, 'UPSTREAM_UNAVAILABLE') });
    renderWithQuery(<DocumentsView />);
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('delete hides the row with Undo, then deletes after 7 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let deleted = '';
    routes({
      'DELETE /documents/*': (_q, _b) => {
        deleted = 'yes';
        return { deleted: true };
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentsView />);
    const rows = await screen.findAllByTestId('document-row');
    await user.click(within(rows[0]).getByRole('button', { name: /^Actions for/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getAllByTestId('document-row')).toHaveLength(5);
    });
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/^Deleted “/),
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) as unknown }),
    );
    expect(deleted).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7100);
    });
    await waitFor(() => {
      expect(deleted).toBe('yes');
    });
  });

  it('undo restores the row and nothing is deleted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let deleted = false;
    routes({
      'DELETE /documents/*': () => {
        deleted = true;
        return { deleted: true };
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<DocumentsView />);
    const rows = await screen.findAllByTestId('document-row');
    await user.click(within(rows[1]).getByRole('button', { name: /^Actions for/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const options = toast.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } };
    act(() => {
      options.action.onClick();
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('document-row')).toHaveLength(6);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(deleted).toBe(false);
  });

  it('row menu: rename opens a dialog and saves the title with PATCH', async () => {
    let body: unknown = null;
    routes({
      'PATCH /documents/*': (_q, b) => {
        body = b;
        return fx11.appraisal.data;
      },
    });
    const user = userEvent.setup();
    renderWithQuery(<DocumentsView />);
    const rows = await screen.findAllByTestId('document-row');
    await user.click(within(rows[0]).getByRole('button', { name: /^Actions for/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Title');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save title' }));
    expect(await screen.findByText('Enter a title')).toBeInTheDocument();
    await user.type(input, 'My H1 review');
    await user.click(screen.getByRole('button', { name: 'Save title' }));
    await waitFor(() => {
      expect(body).toMatchObject({ title: 'My H1 review' });
    });
    expect(toast.success).toHaveBeenCalledWith('Renamed');
  });
});
