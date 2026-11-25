import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calls,
  fail,
  pending,
  renderWithQuery,
  setRoutes,
  type Handler,
} from '../../../../test/api-mock';
import { fx } from '../../../../test/fixtures-p10';
import { fx13, NOW } from '../../../../test/fixtures-p13';
import { setUrl } from '../../../../test/navigation-mock';
import { ActivityView, parseProviderFilter, typesFor } from './activity-view';

vi.mock('@/lib/api/browser', async () => (await import('../../../../test/api-mock')).browserModule);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../test/navigation-mock')).navigationModule,
);
vi.mock(
  'next/dynamic',
  async () => (await import('../../../../test/navigation-mock')).dynamicModule,
);

function routes(overrides: Record<string, Handler | object> = {}) {
  setRoutes({
    'GET /me': fx13.me,
    'GET /integrations': fx13.integrations,
    'GET /activity/feed': fx13.feedIssues,
    'GET /repos': fx.repos,
    'GET /sync/status': fx13.syncStatusGitlab,
    'GET /metrics/definitions': fx13.definitions,
    'GET /activity/issues/*': fx13.issueDetail,
    ...overrides,
  });
}

describe('Activity — issues and sources (S7, P13)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps the Issues chip and provider param', () => {
    expect(typesFor('issue')).toEqual(['issue']);
    expect(parseProviderFilter('gitlab')).toBe('gitlab');
    expect(parseProviderFilter('bitbucket')).toBeNull();
  });

  it('success: completed issues in the feed with key, project, tracker and points; filters send types + providers', async () => {
    setUrl('/activity?type=issue&provider=linear');
    routes();
    renderWithQuery(<ActivityView />);
    const first = fx13.feedIssues.data[0];
    expect((await screen.findAllByText(first.title)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Engineering · Linear/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Source' })).toBeInTheDocument();
    const feedCall = calls.find((c) => c.path === '/activity/feed');
    expect(feedCall?.query).toMatchObject({ types: ['issue'], providers: ['linear'] });
  });

  it('issue drawer (?item=issue:<id>): status, points, cycle time and an Open on Linear/Jira link', async () => {
    const issue = fx13.issueDetail.data;
    setUrl(`/activity?item=issue:${issue.id}`);
    routes();
    renderWithQuery(<ActivityView />);
    const drawer = await screen.findByTestId('item-drawer');
    expect(await within(drawer).findByText(issue.title)).toBeInTheDocument();
    expect(within(drawer).getByText(issue.ref)).toBeInTheDocument();
    expect(within(drawer).getByText('Story points')).toBeInTheDocument();
    const label = issue.provider === 'linear' ? 'Linear' : 'Jira';
    expect(within(drawer).getByRole('link', { name: `Open on ${label}` })).toHaveAttribute(
      'href',
      issue.url,
    );
  });

  it('GitLab rows say GitLab; empty / loading / error states', async () => {
    setUrl('/activity?provider=gitlab');
    routes({ 'GET /activity/feed': fx13.feedGitlab });
    const one = renderWithQuery(<ActivityView />);
    expect((await screen.findAllByText(/· GitLab/)).length).toBeGreaterThan(0);
    one.unmount();
    routes({ 'GET /activity/feed': { data: [], meta: { nextCursor: null, hasMore: false } } });
    const two = renderWithQuery(<ActivityView />);
    expect(await screen.findByRole('button', { name: /Clear filters/ })).toBeInTheDocument();
    two.unmount();
    routes({ 'GET /activity/feed': pending });
    const three = renderWithQuery(<ActivityView />);
    expect(await screen.findByText(/Loading/)).toBeInTheDocument();
    three.unmount();
    routes({ 'GET /activity/feed': fail(503) });
    renderWithQuery(<ActivityView />);
    expect(await screen.findByRole('heading', { name: /Couldn't load/ })).toBeInTheDocument();
  });
});
