/**
 * In-process fake of the GitHub endpoints DevImpact uses (OAuth, REST, GraphQL), installed by
 * intercepting `fetch` for the unroutable test hosts (`*.github.invalid`); every other request (e.g.
 * the local JWKS server) passes through. GraphQL answers are built from a dataset (fixtures under
 * `test/fixtures/github/`) for the exact documents in `src/providers/github/queries.ts`. Every
 * request is logged so tests can assert on call counts and query arguments.
 */
export interface FakeUser {
  id: number;
  node_id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface FakeInstallation {
  id: number;
  account: { login: string; type: string };
  repository_selection: string;
  suspended_at: string | null;
}

export interface FakeRepo {
  nodeId: string;
  fullName: string;
  private?: boolean;
  fork?: boolean;
  archived?: boolean;
  defaultBranch?: string | null;
  installationId?: number | null;
  /** Repository disappeared (GraphQL returns null + NOT_FOUND). */
  missing?: boolean;
}

export interface FakeReview {
  id: string;
  author: string;
  authorType?: 'User' | 'Bot';
  state: string;
  submittedAt: string;
  body?: string;
  comments?: number;
}

export interface FakePullRequest {
  nodeId: string;
  repo: string;
  number: number;
  title: string;
  body?: string | null;
  author: string;
  authorNodeId?: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft?: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: number;
  labels?: string[];
  reviews?: FakeReview[];
  readyForReviewAt?: string | null;
  reviewRequests?: { reviewer: string; at: string }[];
  crossReferences?: {
    title: string;
    url: string;
    state: string;
    mergedAt: string | null;
    repo: string;
    at: string;
  }[];
}

export interface FakeCommit {
  sha: string;
  repo: string;
  authorNodeId: string;
  message: string;
  authoredAt: string;
  additions: number;
  deletions: number;
  changedFiles?: number | null;
  parents?: number;
  prNumber?: number | null;
}

export interface FakeDataset {
  repos: FakeRepo[];
  pullRequests: FakePullRequest[];
  commits: FakeCommit[];
}

export interface RequestLogEntry {
  method: string;
  path: string;
  operation: string | null;
  variables: Record<string, unknown>;
  token: string;
}

export interface FakeGitHubState {
  codes: Map<string, { token: string; refresh?: string }>;
  users: Map<string, FakeUser>;
  installations: Map<string, FakeInstallation[]>;
  revoked: string[];
  exchanges: { code: string; code_verifier?: string; redirect_uri?: string }[];
  /** Refresh tokens GitHub accepts → the new token pair it returns. */
  refreshGrants: Map<string, { token: string; refresh: string }>;
  refreshCalls: string[];
  /** Access tokens GitHub rejects with 401 (revoked / expired). */
  invalidTokens: Set<string>;
  dataset: FakeDataset;
  /** Simulated primary rate-limit budget (decremented per API request). */
  rateLimit: { remaining: number; resetAt: Date };
  /** Fail requests matching the predicate (once each unless `times` is given). */
  faults: {
    match: (entry: RequestLogEntry) => boolean;
    status: number;
    headers?: Record<string, string>;
    times?: number;
  }[];
  log: RequestLogEntry[];
  /** GraphQL cost points charged so far (GitHub's formula, see `graphqlCost`). */
  graphqlPoints: number;
}

/**
 * GitHub's GraphQL cost: add up the requests needed for every connection (a `first: n` page of a
 * connection nested under `m` parents counts `m` requests), divide by 100, round, minimum 1.
 */
export function graphqlCost(operation: string, variables: Record<string, unknown>): number {
  const first = Number(variables.first ?? 50);
  let requests = 1;
  if (operation === 'DevImpactAuthoredPRs')
    requests = 1 + first * 3; // reviews, labels, timeline per PR
  else if (operation === 'DevImpactReviewedPRs')
    requests = 1 + first * 2; // my reviews, timeline
  else if (operation === 'DevImpactCommitHistory') {
    let aliases = 0;
    while (variables[`o${aliases}`] !== undefined) aliases++;
    requests = aliases * (1 + 100); // history page + associatedPullRequests per commit
  } else if (operation === 'DevImpactPullRequest') requests = 1 + 4;
  return Math.max(1, Math.round(requests / 100));
}

const emptyDataset = (): FakeDataset => ({ repos: [], pullRequests: [], commits: [] });

function encodeCursor(offset: number) {
  return Buffer.from(`o:${offset}`).toString('base64');
}
function decodeCursor(cursor: unknown): number {
  if (typeof cursor !== 'string' || !cursor) return 0;
  return Number(Buffer.from(cursor, 'base64').toString().slice(2)) || 0;
}

export function installFakeGitHub(): { state: FakeGitHubState; restore: () => void } {
  const state: FakeGitHubState = {
    codes: new Map(),
    users: new Map(),
    installations: new Map(),
    revoked: [],
    exchanges: [],
    refreshGrants: new Map(),
    refreshCalls: [],
    invalidTokens: new Set(),
    dataset: emptyDataset(),
    rateLimit: { remaining: 5000, resetAt: new Date(Date.now() + 3_600_000) },
    faults: [],
    log: [],
    graphqlPoints: 0,
  };
  const original = globalThis.fetch;

  const rateHeaders = () => ({
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': String(state.rateLimit.remaining),
    'x-ratelimit-reset': String(Math.floor(state.rateLimit.resetAt.getTime() / 1000)),
  });
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...rateHeaders(), ...headers },
    });

  const userByLogin = (login: string) =>
    [...state.users.values()].find((u) => u.login.toLowerCase() === login.toLowerCase());
  const repoByName = (fullName: string) =>
    state.dataset.repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());

  const repoNode = (r: FakeRepo) => {
    const [owner = '', name = ''] = r.fullName.split('/');
    return {
      id: r.nodeId,
      nameWithOwner: r.fullName,
      name,
      owner: { login: owner },
      isPrivate: r.private ?? false,
      isFork: r.fork ?? false,
      isArchived: r.archived ?? false,
      url: `https://github.com/${r.fullName}`,
      defaultBranchRef: r.defaultBranch === null ? null : { name: r.defaultBranch ?? 'main' },
    };
  };
  const restRepo = (r: FakeRepo) => {
    const [owner = '', name = ''] = r.fullName.split('/');
    return {
      node_id: r.nodeId,
      full_name: r.fullName,
      name,
      owner: { login: owner },
      private: r.private ?? false,
      fork: r.fork ?? false,
      archived: r.archived ?? false,
      html_url: `https://github.com/${r.fullName}`,
      default_branch: r.defaultBranch ?? 'main',
    };
  };

  const actor = (login: string, type: 'User' | 'Bot' = 'User', nodeId?: string) => ({
    __typename: type,
    login,
    id: nodeId ?? userByLogin(login)?.node_id ?? `node-${login}`,
  });

  const prNode = (pr: FakePullRequest, viewerLogin: string | null) => {
    const repo = repoByName(pr.repo);
    if (!repo) throw new Error(`fake-github: unknown repo ${pr.repo}`);
    const timeline: unknown[] = [];
    if (pr.readyForReviewAt)
      timeline.push({ __typename: 'ReadyForReviewEvent', createdAt: pr.readyForReviewAt });
    for (const x of pr.crossReferences ?? []) {
      timeline.push({
        __typename: 'CrossReferencedEvent',
        createdAt: x.at,
        source: {
          __typename: 'PullRequest',
          title: x.title,
          url: x.url,
          state: x.state,
          mergedAt: x.mergedAt,
          repository: { id: repoByName(x.repo)?.nodeId ?? 'x' },
        },
      });
    }
    const requests = (pr.reviewRequests ?? []).map((r) => ({
      __typename: 'ReviewRequestedEvent',
      createdAt: r.at,
      requestedReviewer: r.reviewer.startsWith('team:')
        ? { __typename: 'Team', slug: r.reviewer.slice(5) }
        : { __typename: 'User', login: r.reviewer },
    }));
    const mine = (pr.reviews ?? [])
      .filter((r) => r.author.toLowerCase() === viewerLogin?.toLowerCase())
      .map((r) => ({
        id: r.id,
        state: r.state,
        submittedAt: r.submittedAt,
        body: r.body ?? '',
        comments: { totalCount: r.comments ?? 0 },
      }));
    return {
      id: pr.nodeId,
      number: pr.number,
      title: pr.title,
      url: `https://github.com/${pr.repo}/pull/${pr.number}`,
      state: pr.state,
      isDraft: pr.isDraft ?? false,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      mergedAt: pr.mergedAt ?? null,
      closedAt: pr.closedAt ?? null,
      baseRefName: 'main',
      author: actor(pr.author, 'User', pr.authorNodeId),
      repository: repoNode(repo),
      body: pr.body ?? null,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changedFiles ?? 0,
      commits: { totalCount: pr.commits ?? 1 },
      labels: { nodes: (pr.labels ?? []).map((name) => ({ name })) },
      reviews: {
        nodes: (pr.reviews ?? []).map((r) => ({
          state: r.state,
          submittedAt: r.submittedAt,
          author: actor(r.author, r.authorType ?? 'User'),
        })),
      },
      myReviews: { nodes: mine },
      // Authored documents ask for ready/cross-reference events, reviewed ones for requests.
      timelineItems: { nodes: [...timeline, ...requests] },
      requests: { nodes: requests },
    };
  };

  const parseSearch = (q: string) => {
    const author = /(?:^|\s)author:(\S+)/.exec(q)?.[1] ?? null;
    const reviewedBy = /reviewed-by:(\S+)/.exec(q)?.[1] ?? null;
    const notAuthor = /-author:(\S+)/.exec(q)?.[1] ?? null;
    const range = /updated:(\S+)\.\.(\S+)/.exec(q);
    return {
      author: reviewedBy ? null : author,
      reviewedBy,
      notAuthor,
      from: range ? Date.parse(range[1] ?? '') : -Infinity,
      to: range ? Date.parse(range[2] ?? '') : Infinity,
    };
  };

  const graphql = (query: string, variables: Record<string, unknown>) => {
    const cost = graphqlCost(/query (\w+)/.exec(query)?.[1] ?? '', variables);
    state.graphqlPoints += cost;
    const rateLimit = {
      cost,
      remaining: state.rateLimit.remaining,
      resetAt: state.rateLimit.resetAt.toISOString(),
    };
    const op = /query (\w+)/.exec(query)?.[1] ?? '';
    if (op === 'DevImpactAuthoredPRs' || op === 'DevImpactReviewedPRs') {
      const s = parseSearch(String(variables.q));
      const matches = state.dataset.pullRequests
        .filter((pr) => {
          const t = Date.parse(pr.updatedAt);
          if (t < s.from || t > s.to) return false;
          if (s.author) return pr.author.toLowerCase() === s.author.toLowerCase();
          if (s.reviewedBy) {
            if (pr.author.toLowerCase() === s.notAuthor?.toLowerCase()) return false;
            return (pr.reviews ?? []).some(
              (r) =>
                r.author.toLowerCase() === s.reviewedBy?.toLowerCase() && r.state !== 'PENDING',
            );
          }
          return false;
        })
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const offset = decodeCursor(variables.after);
      const first = Number(variables.first ?? 50);
      const capped = matches.slice(0, 1000);
      const page = capped.slice(offset, offset + first);
      const viewer = s.reviewedBy ?? (typeof variables.login === 'string' ? variables.login : null);
      return {
        data: {
          rateLimit,
          search: {
            issueCount: matches.length,
            pageInfo: {
              hasNextPage: offset + first < capped.length,
              endCursor: page.length ? encodeCursor(offset + first) : null,
            },
            nodes: page.map((pr) => prNode(pr, viewer)),
          },
        },
      };
    }
    if (op === 'DevImpactCommitRepos') {
      const user = userByLogin(String(variables.login));
      const from = Date.parse(String(variables.from));
      const to = Date.parse(String(variables.to));
      const counts = new Map<string, number>();
      for (const c of state.dataset.commits) {
        const t = Date.parse(c.authoredAt);
        if (c.authorNodeId !== user?.node_id || t < from || t > to) continue;
        counts.set(c.repo, (counts.get(c.repo) ?? 0) + 1);
      }
      return {
        data: {
          rateLimit,
          user: user
            ? {
                contributionsCollection: {
                  commitContributionsByRepository: [...counts.entries()]
                    .map(([repo, n]) => ({ repo: repoByName(repo), n }))
                    .filter((e): e is { repo: FakeRepo; n: number } => !!e.repo)
                    .slice(0, 100)
                    .map((e) => ({
                      contributions: { totalCount: e.n },
                      repository: repoNode(e.repo),
                    })),
                },
              }
            : null,
        },
      };
    }
    if (op === 'DevImpactCommitHistory') {
      const data: Record<string, unknown> = { rateLimit };
      const errors: unknown[] = [];
      for (let i = 0; variables[`o${i}`] !== undefined; i++) {
        const repo = repoByName(`${String(variables[`o${i}`])}/${String(variables[`n${i}`])}`);
        if (!repo || repo.missing) {
          data[`r${i}`] = null;
          errors.push({
            type: 'NOT_FOUND',
            path: [`r${i}`],
            message: 'Could not resolve to a Repository',
          });
          continue;
        }
        const since = Date.parse(String(variables[`s${i}`]));
        const until = Date.parse(String(variables[`u${i}`]));
        const list = state.dataset.commits
          .filter((c) => c.repo === repo.fullName && c.authorNodeId === variables.author)
          .filter((c) => {
            const t = Date.parse(c.authoredAt);
            return t >= since && t <= until;
          })
          .sort((a, b) => Date.parse(b.authoredAt) - Date.parse(a.authoredAt));
        const offset = decodeCursor(variables[`a${i}`]);
        const page = list.slice(offset, offset + 100);
        data[`r${i}`] = {
          id: repo.nodeId,
          defaultBranchRef:
            repo.defaultBranch === null
              ? null
              : {
                  name: repo.defaultBranch ?? 'main',
                  target: {
                    history: {
                      pageInfo: {
                        hasNextPage: offset + 100 < list.length,
                        endCursor: encodeCursor(offset + 100),
                      },
                      nodes: page.map((c) => ({
                        oid: c.sha,
                        messageHeadline: c.message.split('\n')[0],
                        messageBody: c.message.split('\n').slice(1).join('\n').replace(/^\n+/, ''),
                        authoredDate: c.authoredAt,
                        committedDate: c.authoredAt,
                        additions: c.additions,
                        deletions: c.deletions,
                        changedFilesIfAvailable: c.changedFiles ?? null,
                        parents: { totalCount: c.parents ?? 1 },
                        associatedPullRequests: {
                          nodes: c.prNumber ? [{ number: c.prNumber }] : [],
                        },
                        author: { user: { id: c.authorNodeId } },
                      })),
                    },
                  },
                },
        };
      }
      return errors.length ? { data, errors } : { data };
    }
    if (op === 'DevImpactPullRequest') {
      const fullName = `${String(variables.owner)}/${String(variables.name)}`;
      const pr = state.dataset.pullRequests.find(
        (p) => p.repo === fullName && p.number === variables.number,
      );
      return {
        data: {
          rateLimit,
          repository: repoByName(fullName)
            ? { pullRequest: pr ? prNode(pr, String(variables.login)) : null }
            : null,
        },
      };
    }
    return { errors: [{ type: 'UNKNOWN', message: `fake-github: unsupported operation ${op}` }] };
  };

  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (!url.hostname.endsWith('github.invalid')) return original(input, init);

    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization') ?? '';
    const token = auth.replace(/^(bearer|token)\s+/i, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : '';

    // ── OAuth (github.com)
    if (url.hostname === 'github.invalid' && url.pathname === '/login/oauth/access_token') {
      const body = JSON.parse(rawBody) as {
        code?: string;
        code_verifier?: string;
        redirect_uri?: string;
        grant_type?: string;
        refresh_token?: string;
      };
      if (body.grant_type === 'refresh_token') {
        state.refreshCalls.push(body.refresh_token ?? '');
        const grant = state.refreshGrants.get(body.refresh_token ?? '');
        if (!grant) return json(200, { error: 'bad_refresh_token' });
        state.refreshGrants.delete(body.refresh_token ?? '');
        return json(200, {
          access_token: grant.token,
          expires_in: 28_800,
          refresh_token: grant.refresh,
          refresh_token_expires_in: 15_811_200,
          token_type: 'bearer',
        });
      }
      state.exchanges.push({
        code: body.code ?? '',
        code_verifier: body.code_verifier,
        redirect_uri: body.redirect_uri,
      });
      const grant = state.codes.get(body.code ?? '');
      if (!grant) return json(200, { error: 'bad_verification_code' });
      state.codes.delete(body.code ?? '');
      return json(200, {
        access_token: grant.token,
        expires_in: 28_800,
        refresh_token: grant.refresh ?? `${grant.token}-refresh`,
        refresh_token_expires_in: 15_811_200,
        token_type: 'bearer',
      });
    }
    if (method === 'DELETE' && /^\/applications\/[^/]+\/token$/.test(url.pathname)) {
      const body = JSON.parse(rawBody) as { access_token: string };
      state.revoked.push(body.access_token);
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && /^\/app\/installations\/\d+\/access_tokens$/.test(url.pathname)) {
      return json(201, {
        token: `inst-token-${url.pathname.split('/')[3]}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }

    // ── API (api.github.com): log, faults, rate limit, auth
    let operation: string | null = null;
    let variables: Record<string, unknown> = {};
    let query = '';
    if (url.pathname === '/graphql') {
      const body = JSON.parse(rawBody) as { query: string; variables?: Record<string, unknown> };
      query = body.query;
      variables = body.variables ?? {};
      operation = /query (\w+)/.exec(query)?.[1] ?? null;
    }
    const entry: RequestLogEntry = {
      method,
      path: url.pathname + url.search,
      operation,
      variables,
      token,
    };
    state.log.push(entry);
    const fault = state.faults.find((f) => f.match(entry));
    if (fault) {
      if (fault.times === undefined || --fault.times <= 0)
        state.faults.splice(state.faults.indexOf(fault), 1);
      return json(fault.status, { message: 'fault injected' }, fault.headers);
    }
    if (url.pathname.startsWith('/installation/')) {
      if (!token.startsWith('inst-token-')) return json(401, { message: 'Bad credentials' });
      const id = Number(token.slice('inst-token-'.length));
      const repos = state.dataset.repos.filter((r) => r.installationId === id && !r.missing);
      return json(200, { total_count: repos.length, repositories: repos.map(restRepo) });
    }
    if (state.invalidTokens.has(token) || state.revoked.includes(token))
      return json(401, { message: 'Bad credentials' });
    if (state.rateLimit.remaining <= 0) {
      return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
    }
    state.rateLimit.remaining--;

    if (url.pathname === '/graphql') return json(200, graphql(query, variables));
    if (url.pathname === '/user') {
      const user = state.users.get(token);
      return user ? json(200, user) : json(401, { message: 'Bad credentials' });
    }
    if (url.pathname === '/user/installations') {
      return json(200, { total_count: 0, installations: state.installations.get(token) ?? [] });
    }
    const instRepos = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
    if (instRepos) {
      const id = Number(instRepos[1]);
      const perPage = Number(url.searchParams.get('per_page') ?? 30);
      const page = Number(url.searchParams.get('page') ?? 1);
      const repos = state.dataset.repos.filter((r) => r.installationId === id && !r.missing);
      return json(200, {
        total_count: repos.length,
        repositories: repos.slice((page - 1) * perPage, page * perPage).map(restRepo),
      });
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

/** Requests to the GitHub API host (excludes OAuth endpoints on github.com). */
export const apiRequests = (state: FakeGitHubState) => state.log;
