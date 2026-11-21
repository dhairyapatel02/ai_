import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calls,
  fail,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../../test/api-mock';
import { fx } from '../../../../../test/fixtures-p10';
import { clone, fx11, NOW } from '../../../../../test/fixtures-p11';
import { nav, setUrl } from '../../../../../test/navigation-mock';
import { StudioView } from './studio-view';

vi.mock(
  '@/lib/api/browser',
  async () => (await import('../../../../../test/api-mock')).browserModule,
);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../../test/navigation-mock')).navigationModule,
);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const CREATED = {
  document: { ...fx11.appraisal.data.document, status: 'pending', currentVersion: 0 },
  cached: false,
  streamUrl: '/api/documents/x/stream',
};

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx11.me,
    'GET /me/usage': fx11.usage,
    'GET /sync/status': fx.syncStatus,
    'POST /documents/preview-evidence': fx11.preview,
    'POST /documents': CREATED,
    ...overrides,
  });
}

describe('StudioView (S13–S15)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    calls.length = 0;
    setUrl('/documents/new/appraisal');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appraisal: period presets, evidence preview (counts, top work, engine metrics) and quota line', async () => {
    routes();
    renderWithQuery(<StudioView type="appraisal" />);
    const period = await screen.findByLabelText('Period');
    expect(screen.getByRole('heading', { level: 1, name: 'New appraisal' })).toBeInTheDocument();
    expect(period).toHaveValue('half:2026-H2');
    expect(screen.getByRole('option', { name: 'H2 2026 (in progress)' })).toBeInTheDocument();
    const preview = await screen.findByTestId('evidence-preview');
    const counts = fx11.preview.data.counts;
    await waitFor(() => {
      expect(preview).toHaveTextContent(`PRs merged${counts.prsMerged}`);
    });
    expect(preview).toHaveTextContent(`PRs reviewed${counts.prsReviewed}`);
    expect(preview).toHaveTextContent(fx11.preview.data.topEvidence[0]?.title ?? '');
    expect(preview).toHaveTextContent('Engine metrics');
    expect(preview).toHaveTextContent(
      'Ranked by DevImpact (size, labels, reviews), not by the AI.',
    );
    expect(
      screen.getByText(/In-progress period: the draft covers work up to today\./),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('studio-quota')).toHaveTextContent(
      'Uses 1 of 150 generations left this month · same inputs reuse the last result for free',
    );
    expect(calls.find((c) => c.path === '/documents/preview-evidence')?.body).toEqual({
      type: 'appraisal',
      period: 'half:2026-H2',
    });
  });

  it('pre-fills the period from ?period= and generates → viewer', async () => {
    setUrl('/documents/new/appraisal?period=quarter:2026-Q3');
    routes();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<StudioView type="appraisal" />);
    expect(await screen.findByLabelText('Period')).toHaveValue('quarter:2026-Q3');
    await user.type(screen.getByLabelText(/Self-reflection notes/), 'Proud of the refunds work');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith(`/documents/${CREATED.document.id}`);
    });
    expect(calls.find((c) => c.method === 'POST' && c.path === '/documents')?.body).toEqual({
      type: 'appraisal',
      period: 'quarter:2026-Q3',
      selfReflection: 'Proud of the refunds work',
    });
  });

  it('200 cached opens the existing document with the "reused" note', async () => {
    routes({ 'POST /documents': { ...CREATED, cached: true, streamUrl: null } });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<StudioView type="appraisal" />);
    await user.click(await screen.findByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('Reused your last result — no generation used.');
    });
    expect(nav.push).toHaveBeenCalled();
  });

  it('no evidence: warning and Generate disabled with the reason', async () => {
    const empty = clone(fx11.preview);
    empty.data.counts = { prsMerged: 0, prsReviewed: 0, commits: 0, repos: 0, achievements: 0 };
    empty.data.topEvidence = [];
    routes({ 'POST /documents/preview-evidence': empty });
    renderWithQuery(<StudioView type="appraisal" />);
    expect(await screen.findByText('Not enough evidence')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    expect(screen.getByText('Not enough evidence — choose a longer period')).toBeInTheDocument();
  });

  it('quota used up: footer copy names the reset date, See plan, Generate disabled', async () => {
    const usage = clone(fx11.usage);
    usage.data.generations = { used: 15, limit: 15, resetsAt: '2026-12-01T00:00:00.000Z' };
    routes({ 'GET /me/usage': usage });
    renderWithQuery(<StudioView type="resume" />);
    expect(
      await screen.findByText(
        "You've used all 15 generations for November. They reset on December 1.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plan' })).toHaveAttribute(
      'href',
      '/settings/plan',
    );
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('402 / 429 on submit show the designed copy', async () => {
    routes({
      'POST /documents': fail(402, 'QUOTA_EXCEEDED', {
        feature: 'generations',
        used: 150,
        limit: 150,
        resetsAt: '2026-12-01T00:00:00.000Z',
      }),
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const view = renderWithQuery(<StudioView type="appraisal" />);
    await user.click(await screen.findByRole('button', { name: 'Generate' }));
    expect(
      await screen.findByText(
        "You've used all 150 generations for November. They reset on December 1.",
      ),
    ).toBeInTheDocument();
    view.unmount();

    routes({ 'POST /documents': fail(429, 'RATE_LIMITED') });
    renderWithQuery(<StudioView type="appraisal" />);
    await user.click(await screen.findByRole('button', { name: 'Generate' }));
    expect(
      await screen.findByText(/Too many generations in a short time\. Try again at \d\d:\d\d\./),
    ).toBeInTheDocument();
  });

  it('resume: role, format, length and job description reach the API', async () => {
    setUrl('/documents/new/resume');
    routes();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<StudioView type="resume" />);
    await user.click(await screen.findByRole('radio', { name: 'DevOps' }));
    await user.click(screen.getByRole('radio', { name: 'Narrative' }));
    await user.click(screen.getByRole('radio', { name: 'Short' }));
    await user.type(screen.getByLabelText(/Job description/), 'SRE role');
    expect(screen.getByText('8 / 8,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST' && c.path === '/documents')?.body).toEqual({
        type: 'resume',
        period: 'custom:2025-11-22..2026-11-21',
        role: 'devops',
        format: 'narrative',
        length: 'short',
        jobDescription: 'SRE role',
      });
    });
  });

  it('promotion: required roles are validated and focused; pre-filled from Profile', async () => {
    setUrl('/documents/new/promotion');
    const me = clone(fx11.me);
    me.data.settings.currentRole = 'Senior engineer';
    me.data.settings.targetRole = null;
    routes({ 'GET /me': me });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<StudioView type="promotion" />);
    expect(await screen.findByLabelText('Current role')).toHaveValue('Senior engineer');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByText("Enter the role you're aiming for")).toBeInTheDocument();
    expect(screen.getByLabelText('Target role')).toHaveFocus();
    expect(screen.getByLabelText('Target role')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/documents')).toBe(false);
  });

  it('?regenerate= pre-fills from the document and regenerates it with the changed options', async () => {
    const doc = fx11.appraisal.data.document;
    setUrl(`/documents/new/appraisal?regenerate=${doc.id}`);
    routes({
      [`GET /documents/${doc.id}`]: fx11.appraisal,
      [`POST /documents/${doc.id}/regenerate`]: {
        document: { ...doc, status: 'pending' },
        streamUrl: 's',
      },
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderWithQuery(<StudioView type="appraisal" />);
    expect(
      await screen.findByRole('heading', { name: 'Change options and regenerate' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Period')).toHaveValue('half:2026-H1');
    });
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith(`/documents/${doc.id}`);
    });
    expect(calls.find((c) => c.path.endsWith('/regenerate'))?.body).toEqual({
      options: { period: 'half:2026-H1' },
    });
  });

  it('not connected: the connect state instead of the form', async () => {
    const me = clone(fx11.me);
    me.data.integrations = [];
    routes({ 'GET /me': me });
    renderWithQuery(<StudioView type="appraisal" />);
    expect(
      await screen.findByText('Connect GitHub to write documents from your work'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument();
  });
});
