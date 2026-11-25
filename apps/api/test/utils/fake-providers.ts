/**
 * In-process fakes of the GitLab, Jira Cloud (Atlassian) and Linear endpoints DevImpact uses (P13),
 * installed by wrapping `fetch` for the unroutable test hosts configured in `test-env.ts`
 * (`*.invalid`). Every other request passes through to the previous `fetch` (so it composes with
 * `installFakeGitHub()`). Responses use the recorded shapes of the real APIs; every request is
 * logged so tests can assert on call counts and query arguments.
 */
import type {
  GlCommit,
  GlMergeRequest,
  GlNote,
  GlProject,
} from '../../src/providers/gitlab/mappers';
import type { JiraIssue } from '../../src/providers/jira/mappers';
import type { LinearIssueNode } from '../../src/providers/linear/mappers';

export type FakeProviderKind = 'gitlab' | 'jira' | 'linear';

export interface TokenGrant {
  provider: FakeProviderKind;
  accessToken: string;
  refreshToken: string | null;
  expiresIn?: number;
}

export interface FakeProvidersState {
  codes: Map<string, TokenGrant>;
  refreshGrants: Map<string, TokenGrant>;
  exchanges: Record<string, string>[];
  revoked: { provider: FakeProviderKind; token: string }[];
  invalidTokens: Set<string>;
  /** Codes stay valid after an exchange (E2E server: tests rerun the same round trip). */
  reusableCodes?: boolean;
  /** Next request to this provider answers 429. */
  throttle: Set<FakeProviderKind>;
  log: {
    provider: FakeProviderKind;
    method: string;
    path: string;
    query: Record<string, string>;
    body?: unknown;
  }[];
  gitlab: {
    users: Map<
      string,
      { id: number; username: string; name: string; email: string; avatar_url: null }
    >;
    emails: Map<string, { email: string; confirmed_at: string | null }[]>;
    projects: GlProject[];
    mrs: GlMergeRequest[];
    notes: Map<number, GlNote[]>;
    commits: Map<number, GlCommit[]>;
    events: { project_id: number; created_at: string; push_data: { commit_count: number } }[];
  };
  jira: {
    me: Map<
      string,
      { account_id: string; email: string; name: string; nickname: string; picture: null }
    >;
    sites: { id: string; name: string; url: string; scopes: string[] }[];
    statuses: { id: string; statusCategory: { key: string } }[];
    fields: { id: string; name: string; custom: boolean; schema?: { custom?: string } }[];
    issues: (JiraIssue & { siteId: string })[];
  };
  linear: {
    viewers: Map<
      string,
      {
        id: string;
        name: string;
        displayName: string;
        email: string;
        avatarUrl: null;
        organization: { id: string; name: string; urlKey: string };
      }
    >;
    issues: LinearIssueNode[];
  };
}

const HOSTS: Record<string, FakeProviderKind> = {
  'gitlab.invalid': 'gitlab',
  'gitlab.selfhosted.invalid': 'gitlab',
  'auth.atlassian.invalid': 'jira',
  'api.atlassian.invalid': 'jira',
  'linear.invalid': 'linear',
  'api.linear.invalid': 'linear',
};

export function emptyProvidersState(): FakeProvidersState {
  return {
    codes: new Map(),
    refreshGrants: new Map(),
    exchanges: [],
    revoked: [],
    invalidTokens: new Set(),
    throttle: new Set(),
    log: [],
    gitlab: {
      users: new Map(),
      emails: new Map(),
      projects: [],
      mrs: [],
      notes: new Map(),
      commits: new Map(),
      events: [],
    },
    jira: {
      me: new Map(),
      sites: [
        {
          id: 'cloud-acme',
          name: 'Acme',
          url: 'https://acme.atlassian.net',
          scopes: ['read:jira-work', 'read:jira-user'],
        },
      ],
      statuses: [
        { id: '1', statusCategory: { key: 'new' } },
        { id: '3', statusCategory: { key: 'indeterminate' } },
        { id: '10001', statusCategory: { key: 'done' } },
      ],
      fields: [
        { id: 'summary', name: 'Summary', custom: false },
        {
          id: 'customfield_10016',
          name: 'Story point estimate',
          custom: true,
          schema: { custom: 'com.pyxis.greenhopper.jira:jsw-story-points' },
        },
      ],
      issues: [],
    },
    linear: { viewers: new Map(), issues: [] },
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function bodyOf(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  const raw = init?.body;
  if (typeof raw !== 'string') return Promise.resolve({});
  try {
    return Promise.resolve(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return Promise.resolve(Object.fromEntries(new URLSearchParams(raw)));
  }
}

function page<T>(items: T[], query: Record<string, string>, size: number) {
  const p = Number(query.page ?? '1');
  const slice = items.slice((p - 1) * size, p * size);
  const next = p * size < items.length ? String(p + 1) : '';
  return { slice, headers: { 'x-total': String(items.length), 'x-next-page': next } };
}

export function installFakeProviders(state = emptyProvidersState()): {
  state: FakeProvidersState;
  restore: () => void;
} {
  const previous = globalThis.fetch;

  const tokenOf = (init: RequestInit | undefined): string | null => {
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization');
    return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  };

  const grantToken = (provider: FakeProviderKind, body: Record<string, unknown>) => {
    state.exchanges.push(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])));
    const grant =
      body.grant_type === 'refresh_token'
        ? state.refreshGrants.get(String(body.refresh_token))
        : state.codes.get(String(body.code));
    if (grant?.provider !== provider) return json(400, { error: 'invalid_grant' });
    if (body.grant_type === 'refresh_token') state.refreshGrants.delete(String(body.refresh_token));
    else if (!state.reusableCodes) state.codes.delete(String(body.code));
    return json(200, {
      access_token: grant.accessToken,
      token_type: 'Bearer',
      expires_in: grant.expiresIn ?? 7200,
      ...(grant.refreshToken ? { refresh_token: grant.refreshToken } : {}),
    });
  };

  async function gitlab(
    url: URL,
    method: string,
    init: RequestInit | undefined,
    query: Record<string, string>,
  ) {
    const path = url.pathname;
    if (path === '/oauth/token') return grantToken('gitlab', await bodyOf(init));
    if (path === '/oauth/revoke') {
      state.revoked.push({ provider: 'gitlab', token: String((await bodyOf(init)).token) });
      return json(200, {});
    }
    const token = tokenOf(init);
    const user =
      token && !state.invalidTokens.has(token) ? state.gitlab.users.get(token) : undefined;
    if (!user) return json(401, { message: '401 Unauthorized' });
    const g = state.gitlab;
    if (path === '/api/v4/user') return json(200, { ...user, commit_email: user.email });
    if (path === '/api/v4/user/emails') return json(200, g.emails.get(token ?? '') ?? []);
    if (path === '/api/v4/projects') {
      const { slice, headers } = page(g.projects, query, Number(query.per_page ?? 20));
      return json(200, slice, headers);
    }
    if (path === '/api/v4/merge_requests') {
      const from = Date.parse(query.updated_after ?? '1970-01-01');
      const to = Date.parse(query.updated_before ?? '2999-01-01');
      const byAuthor = query.author_username;
      const byReviewer = query.reviewer_username;
      const items = g.mrs.filter((mr) => {
        const t = Date.parse(mr.updated_at ?? mr.created_at);
        if (t < from || t > to) return false;
        if (byAuthor) return mr.author.username === byAuthor;
        if (byReviewer)
          return ((mr as GlMergeRequest & { reviewers?: string[] }).reviewers ?? []).includes(
            byReviewer,
          );
        return true;
      });
      const { slice, headers } = page(items, query, Number(query.per_page ?? 20));
      return json(200, slice, headers);
    }
    let m = /^\/api\/v4\/users\/(\d+)\/events$/.exec(path);
    if (m) return json(200, g.events, { 'x-next-page': '' });
    m = /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/notes$/.exec(path);
    if (m) {
      const mr = g.mrs.find((x) => String(x.project_id) === m![1] && x.iid === Number(m![2]));
      return mr ? json(200, g.notes.get(mr.id) ?? []) : json(404, { message: '404 Not Found' });
    }
    m = /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)$/.exec(path);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const project = g.projects.find((p) => String(p.id) === key || p.path_with_namespace === key);
      const mr = g.mrs.find((x) => x.project_id === project?.id && x.iid === Number(m![2]));
      return mr ? json(200, mr) : json(404, { message: '404 Not Found' });
    }
    m = /^\/api\/v4\/projects\/([^/]+)\/repository\/commits$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      if (!g.projects.some((p) => p.id === id))
        return json(404, { message: '404 Project Not Found' });
      const since = Date.parse(query.since ?? '1970-01-01');
      const until = Date.parse(query.until ?? '2999-01-01');
      const author = (query.author ?? '').toLowerCase();
      const items = (g.commits.get(id) ?? []).filter((c) => {
        const t = Date.parse(c.authored_date);
        return (
          t >= since &&
          t <= until &&
          (!author || (c.author_email ?? '').toLowerCase().includes(author))
        );
      });
      const { slice, headers } = page(items, query, Number(query.per_page ?? 20));
      return json(200, slice, headers);
    }
    m = /^\/api\/v4\/projects\/([^/]+)$/.exec(path);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const project = g.projects.find((p) => String(p.id) === key || p.path_with_namespace === key);
      return project ? json(200, project) : json(404, { message: '404 Project Not Found' });
    }
    return json(404, { message: `fake gitlab: no route ${method} ${path}` });
  }

  async function jira(url: URL, method: string, init: RequestInit | undefined) {
    const path = url.pathname;
    if (url.host === 'auth.atlassian.invalid' && path === '/oauth/token') {
      return grantToken('jira', await bodyOf(init));
    }
    const token = tokenOf(init);
    const me = token && !state.invalidTokens.has(token) ? state.jira.me.get(token) : undefined;
    if (!me) return json(401, { code: 401, message: 'Unauthorized' });
    if (path === '/me') return json(200, me);
    if (path === '/oauth/token/accessible-resources') return json(200, state.jira.sites);
    const m = /^\/ex\/jira\/([^/]+)\/rest\/api\/3\/(status|field|search\/jql)$/.exec(path);
    if (!m) return json(404, { errorMessages: [`fake jira: no route ${method} ${path}`] });
    const site = decodeURIComponent(m[1]);
    if (m[2] === 'status') return json(200, state.jira.statuses);
    if (m[2] === 'field') return json(200, state.jira.fields);
    const body = await bodyOf(init);
    const jql = typeof body.jql === 'string' ? body.jql : '';
    const parsed = /assignee = "([^"]+)" AND updated >= -(\d+)m AND updated <= -(\d+)m/.exec(jql);
    if (!parsed) return json(400, { errorMessages: ['Unsupported JQL'] });
    const now = Date.now();
    const from = now - Number(parsed[2]) * 60_000;
    const to = now - Number(parsed[3]) * 60_000;
    const all = state.jira.issues.filter((i) => {
      const t = Date.parse(String(i.fields.updated));
      return (
        i.siteId === site && i.fields.assignee?.accountId === parsed[1] && t >= from && t <= to
      );
    });
    const offset = Number(body.nextPageToken ?? '0');
    const size = Number(body.maxResults ?? 50);
    const slice = all.slice(offset, offset + size);
    const isLast = offset + size >= all.length;
    return json(200, {
      issues: slice.map(({ siteId: _site, ...issue }) => issue),
      isLast,
      ...(isLast ? {} : { nextPageToken: String(offset + size) }),
    });
  }

  async function linear(url: URL, method: string, init: RequestInit | undefined) {
    const path = url.pathname;
    if (path === '/oauth/token') return grantToken('linear', await bodyOf(init));
    const token = tokenOf(init);
    if (path === '/oauth/revoke') {
      state.revoked.push({ provider: 'linear', token: token ?? '' });
      return json(200, {});
    }
    const viewer =
      token && !state.invalidTokens.has(token) ? state.linear.viewers.get(token) : undefined;
    if (!viewer)
      return json(401, {
        errors: [
          { message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } },
        ],
      });
    if (path !== '/graphql' || method !== 'POST') return json(404, {});
    const body = (await bodyOf(init)) as {
      query?: string;
      variables?: Record<string, string | null>;
    };
    const headers = {
      'x-ratelimit-requests-remaining': '1400',
      'x-ratelimit-requests-reset': String(Date.now() + 3_600_000),
    };
    if (body.query?.includes('viewer')) return json(200, { data: { viewer } }, headers);
    if (body.query?.includes('issues(')) {
      const v = body.variables ?? {};
      const from = Date.parse(String(v.from));
      const to = Date.parse(String(v.to));
      const all = state.linear.issues.filter((i) => {
        const t = Date.parse(i.updatedAt);
        return i.assignee?.id === v.assignee && t >= from && t <= to;
      });
      const offset = Number(v.after ?? '0');
      const slice = all.slice(offset, offset + 50);
      const hasNextPage = offset + 50 < all.length;
      return json(
        200,
        {
          data: {
            issues: {
              nodes: slice,
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(offset + 50) : null },
            },
          },
        },
        headers,
      );
    }
    return json(400, {
      errors: [{ message: 'Unknown query', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }],
    });
  }

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const provider = HOSTS[url.host];
    if (!provider) return previous(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const query = Object.fromEntries(url.searchParams);
    const body = method === 'POST' ? await bodyOf(init) : undefined;
    state.log.push({ provider, method, path: url.pathname, query, ...(body ? { body } : {}) });
    if (state.throttle.has(provider) && !url.pathname.startsWith('/oauth')) {
      state.throttle.delete(provider);
      return json(429, { message: 'Too Many Requests' }, { 'retry-after': '120' });
    }
    if (provider === 'gitlab') return gitlab(url, method, init, query);
    if (provider === 'jira') return jira(url, method, init);
    return linear(url, method, init);
  };

  return {
    state,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}

// ── Recorded-shape builders ────────────────────────────────────────────────────────────────

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86_400_000;

/** A GitLab user + one project with an authored MR (approved by a reviewer), one MR the user
 *  reviewed, and default-branch commits (one by an unlinked email). */
export function gitlabDataset(state: FakeProvidersState, token: string) {
  const g = state.gitlab;
  g.users.set(token, {
    id: 10,
    username: 'dana',
    name: 'Dana',
    email: 'dana@example.test',
    avatar_url: null,
  });
  g.emails.set(token, [
    { email: 'dana@example.test', confirmed_at: iso(100 * DAY) },
    { email: 'unconfirmed@example.test', confirmed_at: null },
  ]);
  g.projects = [
    {
      id: 42,
      path: 'billing',
      path_with_namespace: 'acme/platform/billing',
      namespace: { full_path: 'acme/platform' },
      visibility: 'private',
      default_branch: 'main',
      web_url: 'https://gitlab.invalid/acme/platform/billing',
    },
  ];
  const author = { id: 10, username: 'dana' };
  const sam = { id: 20, username: 'sam' };
  g.mrs = [
    {
      id: 9001,
      iid: 12,
      project_id: 42,
      title: 'Add idempotency keys to invoices',
      description: 'Prevents duplicate invoices.',
      state: 'merged',
      author,
      labels: ['billing'],
      target_branch: 'main',
      web_url: 'https://gitlab.invalid/acme/platform/billing/-/merge_requests/12',
      created_at: iso(5 * DAY),
      updated_at: iso(3 * DAY),
      merged_at: iso(3 * DAY),
    },
    Object.assign(
      {
        id: 9002,
        iid: 13,
        project_id: 42,
        title: 'Usage-based billing meter',
        description: 'Someone else’s MR body (never stored)',
        state: 'opened' as const,
        author: sam,
        labels: [],
        web_url: 'https://gitlab.invalid/acme/platform/billing/-/merge_requests/13',
        created_at: iso(4 * DAY),
        updated_at: iso(2 * DAY),
      },
      { reviewers: ['dana'] },
    ),
  ];
  g.notes.set(9001, [
    { id: 1, body: 'Nice', system: false, author: sam, created_at: iso(4 * DAY) },
    {
      id: 2,
      body: 'approved this merge request',
      system: true,
      author: sam,
      created_at: iso(4 * DAY - 3600_000),
    },
  ]);
  g.notes.set(9002, [
    {
      id: 3,
      body: 'requested review from @dana',
      system: true,
      author: sam,
      created_at: iso(4 * DAY),
    },
    { id: 4, body: 'Please add a test', system: false, author, created_at: iso(3 * DAY) },
    { id: 5, body: 'approved this merge request', system: true, author, created_at: iso(2 * DAY) },
  ]);
  g.commits.set(42, [
    {
      id: 'a1'.padEnd(40, '0'),
      title: 'Add idempotency key column',
      message: 'Add idempotency key column',
      author_email: 'dana@example.test',
      authored_date: iso(4 * DAY),
      parent_ids: ['p'],
      stats: { additions: 20, deletions: 2 },
    },
    {
      id: 'b2'.padEnd(40, '0'),
      title: 'Old laptop commit',
      message: 'Old laptop commit',
      author_email: 'dana@old-laptop.test',
      authored_date: iso(4 * DAY),
      parent_ids: ['p'],
      stats: { additions: 1, deletions: 1 },
    },
  ]);
  g.events = [{ project_id: 42, created_at: iso(4 * DAY), push_data: { commit_count: 2 } }];
}

export function jiraIssue(
  key: string,
  options: {
    accountId: string;
    status?: 'done' | 'indeterminate' | 'new';
    resolution?: string | null;
    points?: number | null;
    updatedMsAgo?: number;
    siteId?: string;
  },
): JiraIssue & { siteId: string } {
  const updated = iso(options.updatedMsAgo ?? 2 * DAY);
  const status = options.status ?? 'done';
  const statusId = status === 'done' ? '10001' : status === 'indeterminate' ? '3' : '1';
  return {
    siteId: options.siteId ?? 'cloud-acme',
    id: String(10_000 + Number(key.split('-')[1] ?? 0)),
    key,
    fields: {
      summary: `Issue ${key}`,
      status: {
        id: statusId,
        name: status === 'done' ? 'Done' : 'In Progress',
        statusCategory: { key: status },
      },
      priority: { name: 'High' },
      labels: ['billing'],
      project: { key: key.split('-')[0], name: 'Payments' },
      created: iso((options.updatedMsAgo ?? 2 * DAY) + 3 * DAY),
      updated,
      resolutiondate: status === 'done' ? updated : null,
      resolution: status === 'done' ? { name: options.resolution ?? 'Done' } : null,
      assignee: { accountId: options.accountId },
      customfield_10016: options.points === undefined ? 3 : options.points,
    },
    changelog: {
      histories: [
        {
          created: iso((options.updatedMsAgo ?? 2 * DAY) + DAY),
          items: [{ field: 'status', fieldId: 'status', to: '3' }],
        },
      ],
    },
  };
}

export function linearIssue(
  identifier: string,
  options: { assigneeId: string; type?: string; estimate?: number | null; updatedMsAgo?: number },
): LinearIssueNode {
  const updated = iso(options.updatedMsAgo ?? 2 * DAY);
  const type = options.type ?? 'completed';
  return {
    id: `lin-${identifier}`,
    identifier,
    title: `Linear ${identifier}`,
    url: `https://linear.invalid/acme/issue/${identifier}`,
    priority: 2,
    estimate: options.estimate === undefined ? 2 : options.estimate,
    createdAt: iso((options.updatedMsAgo ?? 2 * DAY) + 3 * DAY),
    updatedAt: updated,
    startedAt: iso((options.updatedMsAgo ?? 2 * DAY) + DAY),
    completedAt: type === 'completed' ? updated : null,
    canceledAt: type === 'canceled' ? updated : null,
    state: { type, name: type },
    labels: { nodes: [{ name: 'perf' }] },
    team: { key: identifier.split('-')[0], name: 'Engineering' },
    project: { name: 'Checkout' },
    cycle: { number: 7, name: null },
    assignee: { id: options.assigneeId },
  };
}
