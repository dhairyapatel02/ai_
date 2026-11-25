import { parseGitLabWebhook } from './gitlab.provider';
import { originOf, parseGitLabInstances } from './instances';
import {
  analyzeNotes,
  isBot,
  mapCommit,
  mapMergeRequest,
  mapMrState,
  mapProject,
  mergeRequestNumberOf,
  numericId,
  type GlMergeRequest,
  type GlNote,
} from './mappers';

const host = 'gitlab.com';
const user = (id: number, username: string, extra = {}) => ({ id, username, ...extra });
const note = (id: number, authorId: number, body: string, system: boolean, at: string): GlNote => ({
  id,
  body,
  system,
  author: user(authorId, `u${authorId}`),
  created_at: at,
});

describe('GitLab mappers', () => {
  const project = mapProject(
    {
      id: 42,
      path: 'billing',
      path_with_namespace: 'acme/platform/billing',
      namespace: { full_path: 'acme/platform' },
      visibility: 'private',
      archived: false,
      default_branch: 'main',
      web_url: 'https://gitlab.com/acme/platform/billing',
    },
    host,
  );

  it('maps projects with host-prefixed ids and nested groups', () => {
    expect(project).toMatchObject({
      externalId: 'gitlab.com/42',
      fullName: 'acme/platform/billing',
      ownerLogin: 'acme/platform',
      name: 'billing',
      isPrivate: true,
      installationId: null,
    });
    expect(numericId(project.externalId)).toBe(42);
    expect(numericId('nope')).toBeNull();
  });

  it.each([
    ['merged', 'MERGED'],
    ['closed', 'CLOSED'],
    ['opened', 'OPEN'],
    ['locked', 'OPEN'],
  ] as const)('MR state %s → %s', (state, expected) => {
    expect(mapMrState(state)).toBe(expected);
  });

  it('detects bots (flag, access-token bots, -bot accounts)', () => {
    expect(isBot(user(1, 'renovate-bot'))).toBe(true);
    expect(isBot(user(1, 'project_12_bot_abc'))).toBe(true);
    expect(isBot(user(1, 'dana', { bot: true }))).toBe(true);
    expect(isBot(user(1, 'dana'))).toBe(false);
  });

  const notes: GlNote[] = [
    note(1, 10, 'marked this merge request as **ready**', true, '2026-10-02T09:00:00Z'),
    note(2, 10, 'requested review from @sam and @dana', true, '2026-10-02T09:05:00Z'),
    note(3, 20, 'Looks good, one nit', false, '2026-10-02T12:00:00Z'),
    note(4, 20, 'Another comment', false, '2026-10-02T13:00:00Z'),
    note(5, 20, 'approved this merge request', true, '2026-10-02T14:00:00Z'),
    note(6, 30, 'requested changes', true, '2026-10-02T10:00:00Z'),
    {
      ...note(7, 99, 'approved this merge request', true, '2026-10-02T08:00:00Z'),
      author: user(99, 'ci-bot'),
    },
    note(8, 10, 'author reply', false, '2026-10-02T15:00:00Z'),
  ];

  it('derives received-review aggregates for the author (bots and the author excluded)', () => {
    const a = analyzeNotes(notes, { host, mrId: 900, authorId: 10, userId: 10, username: 'dana' });
    expect(a.readyForReviewAt?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    expect(a.firstReviewAt?.toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(a.reviewersCount).toBe(2);
    expect(a.approvalsCount).toBe(1);
    expect(a.changesRequestedCount).toBe(1);
    expect(a.myReviews).toEqual([]); // the author never reviews their own MR
  });

  it('maps the reviewer’s approval + comments to reviews (comments aggregated once per MR)', () => {
    const a = analyzeNotes(notes, { host, mrId: 900, authorId: 10, userId: 20, username: 'dana' });
    expect(a.myReviews).toEqual([
      expect.objectContaining({
        externalId: 'gitlab.com/note/5',
        state: 'APPROVED',
        hasBody: false,
        reviewRequestedAt: new Date('2026-10-02T09:05:00Z'),
      }),
      expect.objectContaining({
        externalId: 'gitlab.com/mr/900/comments/20',
        state: 'COMMENTED',
        commentsCount: 2,
        submittedAt: new Date('2026-10-02T12:00:00Z'),
      }),
    ]);
  });

  it('maps change requests and ignores unapprovals', () => {
    const a = analyzeNotes(
      [
        note(1, 30, 'requested changes', true, '2026-10-01T00:00:00Z'),
        note(2, 30, 'unapproved this merge request', true, '2026-10-01T01:00:00Z'),
      ],
      { host, mrId: 1, authorId: 10, userId: 30, username: 'kofi' },
    );
    expect(a.myReviews.map((r) => r.state)).toEqual(['CHANGES_REQUESTED']);
  });

  const mr: GlMergeRequest = {
    id: 900,
    iid: 12,
    project_id: 42,
    title: 'Revert "Add cache"',
    description: 'Body',
    state: 'merged',
    draft: false,
    author: user(10, 'dana'),
    labels: ['perf'],
    target_branch: 'main',
    web_url: 'https://gitlab.com/acme/platform/billing/-/merge_requests/12',
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-03T09:00:00Z',
    merged_at: '2026-10-03T08:00:00Z',
    closed_at: null,
    changes_count: '7',
  };

  it('maps an authored MR to a PR (body kept, sizes unknown, revert detected)', () => {
    const analysis = analyzeNotes(notes, {
      host,
      mrId: 900,
      authorId: 10,
      userId: 10,
      username: 'dana',
    });
    const pr = mapMergeRequest(mr, project, { host, authored: true, notes: analysis });
    expect(pr).toMatchObject({
      externalId: 'gitlab.com/mr/900',
      number: 12,
      state: 'MERGED',
      body: 'Body',
      authorExternalId: 'gitlab.com/10',
      additions: null,
      deletions: null,
      changedFiles: 7,
      isRevert: true,
      reviewersCount: 2,
    });
    expect(pr.closedAt?.toISOString()).toBe('2026-10-03T08:00:00.000Z');
  });

  it('drops body and aggregates for reviewed MRs (ARCHITECTURE_V2 §12)', () => {
    const pr = mapMergeRequest(mr, project, { host, authored: false, notes: null });
    expect(pr.body).toBeNull();
    expect(pr.reviewersCount).toBeNull();
    expect(pr.firstReviewAt).toBeNull();
  });

  it('maps commits (headline/body, MR number from the merge message)', () => {
    const c = mapCommit(
      {
        id: 'a'.repeat(40),
        title: 'Merge branch x',
        message: 'Merge branch x\n\nSee merge request acme/platform/billing!12',
        authored_date: '2026-10-01T00:00:00Z',
        parent_ids: ['p1', 'p2'],
        stats: { additions: 3, deletions: 1 },
      },
      'gitlab.com/42',
      'main',
      'gitlab.com/10',
    );
    expect(c).toMatchObject({
      parentsCount: 2,
      associatedPrNumber: 12,
      additions: 3,
      deletions: 1,
    });
    expect(c.messageBody).toBe('See merge request acme/platform/billing!12');
    expect(mergeRequestNumberOf('nothing')).toBeNull();
  });
});

describe('GitLab instances (SSRF allow-list)', () => {
  it('accepts origins only', () => {
    expect(originOf('https://gitlab.example.com')).toBe('https://gitlab.example.com');
    expect(originOf('https://gitlab.example.com/')).toBe('https://gitlab.example.com');
    expect(originOf('https://gitlab.example.com/api')).toBeNull();
    expect(originOf('https://user:pw@gitlab.example.com')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });

  it('parses GITLAB_INSTANCES_JSON', () => {
    expect(parseGitLabInstances(undefined)).toEqual({ ok: true, instances: [] });
    expect(parseGitLabInstances('nope').ok).toBe(false);
    expect(
      parseGitLabInstances('[{"url":"https://g.example.com/x","clientId":"a","clientSecret":"b"}]')
        .ok,
    ).toBe(false);
    expect(
      parseGitLabInstances('[{"url":"https://g.example.com","clientId":"a","clientSecret":"b"}]'),
    ).toEqual({
      ok: true,
      instances: [
        { url: 'https://g.example.com', clientId: 'a', clientSecret: 'b', label: 'g.example.com' },
      ],
    });
  });
});

describe('GitLab webhooks', () => {
  it('normalises MR / note / push hooks to activity_changed', () => {
    expect(
      parseGitLabWebhook('Merge Request Hook', {
        project: { id: 42, web_url: 'https://gitlab.com/acme/platform/billing' },
        user: { id: 20 },
        object_attributes: { author_id: 10 },
      }),
    ).toEqual({
      kind: 'activity_changed',
      provider: 'gitlab',
      accountExternalIds: ['gitlab.com/20', 'gitlab.com/10'],
      repositoryExternalIds: ['gitlab.com/42'],
      siteId: null,
    });
  });

  it('ignores other events and malformed payloads', () => {
    expect(parseGitLabWebhook('Pipeline Hook', {}).kind).toBe('ignored');
    expect(parseGitLabWebhook('Push Hook', { project: { id: 'x' } }).kind).toBe('ignored');
    expect(parseGitLabWebhook('Push Hook', { project: { id: 1, web_url: '::' } }).kind).toBe(
      'ignored',
    );
  });
});
