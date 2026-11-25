import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calls, fail, setRoutes } from '../../../../../../test/api-mock';
import { byProvider, fx13 } from '../../../../../../test/fixtures-p13';
import { nav, setUrl } from '../../../../../../test/navigation-mock';
import { ProviderCallback, providerCallbackBody } from './provider-callback';

vi.mock(
  '@/lib/api/browser',
  async () => (await import('../../../../../../test/api-mock')).browserModule,
);
vi.mock(
  'next/navigation',
  async () => (await import('../../../../../../test/navigation-mock')).navigationModule,
);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const run = fx13.syncRunsJira.data[0];

describe('ProviderCallback (/integrations/:provider/callback, P13)', () => {
  beforeEach(() => {
    calls.length = 0;
    setUrl('/integrations/jira/callback?code=abc&state=s1');
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('forwards code + state once, strips them from the URL and returns to Settings', async () => {
    setRoutes({
      'POST /integrations/jira/callback': {
        data: { integration: byProvider('jira'), syncRun: run, returnTo: '/settings/integrations' },
      },
    });
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<ProviderCallback provider="jira" params={{ code: 'abc', state: 's1' }} />);
    expect(
      screen.getByRole('heading', { name: 'Connecting your Jira account…' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith('/settings/integrations');
    });
    expect(replace).toHaveBeenCalledWith(null, '', '/integrations/jira/callback');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ code: 'abc', state: 's1' });
    expect(toast.success).toHaveBeenCalledWith('Jira connected. Importing your activity…');
  });

  it('maps API errors to ?connectError=&provider=', async () => {
    setRoutes({ 'POST /integrations/gitlab/callback': fail(400, 'OAUTH_DENIED') });
    render(<ProviderCallback provider="gitlab" params={{ error: 'access_denied', state: 's' }} />);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith(
        '/settings/integrations?connectError=denied&provider=gitlab',
      );
    });
  });

  it('missing state → expired without calling the API', async () => {
    render(<ProviderCallback provider="linear" params={{ code: 'x' }} />);
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith(
        '/settings/integrations?connectError=expired&provider=linear',
      );
    });
    expect(calls).toHaveLength(0);
    expect(providerCallbackBody({ code: 'c', state: 's', error_description: 'no' })).toEqual({
      code: 'c',
      state: 's',
      errorDescription: 'no',
    });
  });
});
