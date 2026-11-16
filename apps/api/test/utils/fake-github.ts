/**
 * Intercepts `fetch` calls to the (unroutable) test GitHub hosts and answers like GitHub's OAuth
 * and REST endpoints. Every other request (e.g. the local JWKS server) passes through.
 */
export interface FakeGitHubState {
  codes: Map<string, { token: string; refresh?: string }>;
  users: Map<
    string,
    { id: number; node_id: string; login: string; name: string | null; avatar_url: string | null }
  >;
  installations: Map<
    string,
    {
      id: number;
      account: { login: string; type: string };
      repository_selection: string;
      suspended_at: string | null;
    }[]
  >;
  revoked: string[];
  exchanges: { code: string; code_verifier?: string; redirect_uri?: string }[];
}

export function installFakeGitHub(): { state: FakeGitHubState; restore: () => void } {
  const state: FakeGitHubState = {
    codes: new Map(),
    users: new Map(),
    installations: new Map(),
    revoked: [],
    exchanges: [],
  };
  const original = globalThis.fetch;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (!url.hostname.endsWith('github.invalid')) return original(input, init);

    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const token = auth.replace(/^Bearer /, '');

    if (url.hostname === 'github.invalid' && url.pathname === '/login/oauth/access_token') {
      const body = JSON.parse(init?.body as string) as {
        code: string;
        code_verifier?: string;
        redirect_uri?: string;
      };
      state.exchanges.push(body);
      const grant = state.codes.get(body.code);
      if (!grant) return json(200, { error: 'bad_verification_code' });
      state.codes.delete(body.code);
      return json(200, {
        access_token: grant.token,
        expires_in: 28_800,
        refresh_token: grant.refresh ?? `${grant.token}-refresh`,
        refresh_token_expires_in: 15_811_200,
        token_type: 'bearer',
      });
    }
    if (url.pathname === '/user') {
      const user = state.users.get(token);
      return user ? json(200, user) : json(401, { message: 'Bad credentials' });
    }
    if (url.pathname === '/user/installations') {
      return json(200, { total_count: 0, installations: state.installations.get(token) ?? [] });
    }
    if (init?.method === 'DELETE' && /^\/applications\/[^/]+\/token$/.test(url.pathname)) {
      const body = JSON.parse(init.body as string) as { access_token: string };
      state.revoked.push(body.access_token);
      return new Response(null, { status: 204 });
    }
    return json(404, { message: 'Not Found' });
  });

  return {
    state,
    restore: () => {
      spy.mockRestore();
    },
  };
}
