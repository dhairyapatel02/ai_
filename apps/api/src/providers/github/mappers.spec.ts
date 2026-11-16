import {
  isBot,
  mapAuthoredPullRequest,
  mapCommit,
  mapReviewedPullRequest,
  prState,
  searchRange,
  splitWindow,
  type GqlPullRequest,
} from './mappers';

const repo = {
  id: 'R1',
  nameWithOwner: 'acme/api',
  name: 'api',
  owner: { login: 'acme' },
  isPrivate: true,
  isFork: false,
  isArchived: false,
  url: 'https://github.com/acme/api',
  defaultBranchRef: { name: 'trunk' },
};

const base: GqlPullRequest = {
  id: 'PR1',
  number: 7,
  title: 'Billing',
  url: 'https://github.com/acme/api/pull/7',
  state: 'MERGED',
  isDraft: false,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-03T10:00:00Z',
  mergedAt: '2026-10-03T10:00:00Z',
  closedAt: '2026-10-03T10:00:00Z',
  baseRefName: 'trunk',
  author: { __typename: 'User', login: 'octo', id: 'U_octo' },
  repository: repo,
};

describe('GitHub mappers', () => {
  it('detects bots by type or [bot] suffix', () => {
    expect(isBot({ __typename: 'Bot', login: 'renovate' })).toBe(true);
    expect(isBot({ __typename: 'User', login: 'dependabot[bot]' })).toBe(true);
    expect(isBot({ __typename: 'User', login: 'alice' })).toBe(false);
  });

  it('maps PR state with merged taking precedence', () => {
    expect(prState('CLOSED', '2026-01-01T00:00:00Z')).toBe('MERGED');
    expect(prState('CLOSED', null)).toBe('CLOSED');
    expect(prState('OPEN', null)).toBe('OPEN');
  });

  it('authored PR: received-review aggregates exclude bots, the author and pending reviews', () => {
    const pr = mapAuthoredPullRequest({
      ...base,
      body: 'body',
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      commits: { totalCount: 2 },
      labels: { nodes: [{ name: 'feature' }] },
      reviews: {
        nodes: [
          {
            state: 'COMMENTED',
            submittedAt: '2026-10-01T11:00:00Z',
            author: { __typename: 'Bot', login: 'ci' },
          },
          {
            state: 'COMMENTED',
            submittedAt: '2026-10-01T11:30:00Z',
            author: { __typename: 'User', login: 'octo' },
          },
          {
            state: 'PENDING',
            submittedAt: '2026-10-01T11:40:00Z',
            author: { __typename: 'User', login: 'bob' },
          },
          {
            state: 'CHANGES_REQUESTED',
            submittedAt: '2026-10-01T12:00:00Z',
            author: { __typename: 'User', login: 'alice' },
          },
          {
            state: 'APPROVED',
            submittedAt: '2026-10-02T12:00:00Z',
            author: { __typename: 'User', login: 'alice' },
          },
          {
            state: 'APPROVED',
            submittedAt: '2026-10-02T13:00:00Z',
            author: { __typename: 'User', login: 'carol' },
          },
        ],
      },
      timelineItems: {
        nodes: [
          { __typename: 'ReadyForReviewEvent', createdAt: '2026-10-01T10:30:00Z' },
          {
            __typename: 'CrossReferencedEvent',
            createdAt: '2026-10-05T00:00:00Z',
            source: {
              __typename: 'PullRequest',
              title: 'Revert "Billing"',
              url: 'https://x/9',
              state: 'MERGED',
              mergedAt: '2026-10-06T00:00:00Z',
              repository: { id: 'R1' },
            },
          },
          {
            __typename: 'CrossReferencedEvent',
            createdAt: '2026-10-04T00:00:00Z',
            source: {
              __typename: 'PullRequest',
              title: 'Revert "Billing"',
              url: 'https://x/other',
              state: 'MERGED',
              mergedAt: '2026-10-04T00:00:00Z',
              repository: { id: 'OTHER' },
            },
          },
          {
            __typename: 'CrossReferencedEvent',
            createdAt: '2026-10-04T00:00:00Z',
            source: {
              __typename: 'PullRequest',
              title: 'Follow-up',
              url: 'https://x/8',
              state: 'MERGED',
              mergedAt: '2026-10-04T00:00:00Z',
              repository: { id: 'R1' },
            },
          },
        ],
      },
    });
    expect(pr).toMatchObject({
      body: 'body',
      labels: ['feature'],
      firstReviewAt: new Date('2026-10-01T12:00:00Z'),
      reviewersCount: 2,
      approvalsCount: 2,
      changesRequestedCount: 1,
      readyForReviewAt: new Date('2026-10-01T10:30:00Z'),
      revertedAt: new Date('2026-10-06T00:00:00Z'),
      revertedByUrl: 'https://x/9',
      repository: { fullName: 'acme/api', defaultBranch: 'trunk', isPrivate: true },
    });
  });

  it('reviewed PR: no body/size, only the user’s non-pending reviews with request times', () => {
    const { pullRequest, reviews } = mapReviewedPullRequest(
      {
        ...base,
        author: { __typename: 'User', login: 'alice' },
        body: 'secret',
        myReviews: {
          nodes: [
            {
              id: 'RV1',
              state: 'CHANGES_REQUESTED',
              submittedAt: '2026-10-02T00:00:00Z',
              body: 'fix',
              comments: { totalCount: 3 },
            },
            {
              id: 'RV2',
              state: 'PENDING',
              submittedAt: null,
              body: '',
              comments: { totalCount: 0 },
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              __typename: 'ReviewRequestedEvent',
              createdAt: '2026-10-03T00:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
            {
              __typename: 'ReviewRequestedEvent',
              createdAt: '2026-10-01T09:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'OCTO' },
            },
          ],
        },
      },
      'octo',
    );
    expect(pullRequest).toMatchObject({ body: null, additions: null, authorLogin: 'alice' });
    expect(reviews).toEqual([
      {
        externalId: 'RV1',
        state: 'CHANGES_REQUESTED',
        submittedAt: new Date('2026-10-02T00:00:00Z'),
        hasBody: true,
        commentsCount: 3,
        reviewRequestedAt: new Date('2026-10-01T09:00:00Z'),
      },
    ]);
  });

  it('maps commits with the real branch, stats and associated PR', () => {
    expect(
      mapCommit(
        {
          oid: 'abc',
          messageHeadline: 'feat: x',
          messageBody: '\nDetails\n',
          authoredDate: '2026-10-01T00:00:00Z',
          committedDate: null,
          additions: 5,
          deletions: 1,
          changedFilesIfAvailable: null,
          parents: { totalCount: 2 },
          associatedPullRequests: { nodes: [{ number: 9 }] },
          author: { user: null },
        },
        'R1',
        'trunk',
      ),
    ).toEqual({
      sha: 'abc',
      repositoryExternalId: 'R1',
      messageHeadline: 'feat: x',
      messageBody: 'Details',
      branch: 'trunk',
      authoredAt: new Date('2026-10-01T00:00:00Z'),
      committedAt: null,
      additions: 5,
      deletions: 1,
      changedFiles: null,
      parentsCount: 2,
      associatedPrNumber: 9,
      authorExternalId: null,
    });
  });

  it('search ranges widen to whole seconds; windows split into two non-overlapping halves', () => {
    expect(
      searchRange(new Date('2026-10-01T00:00:00.900Z'), new Date('2026-10-02T00:00:00.100Z')),
    ).toBe('2026-10-01T00:00:00Z..2026-10-02T00:00:01Z');
    const [a, b] = splitWindow(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-03T00:00:00Z'));
    expect(a[1].toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(b[0].toISOString()).toBe('2026-10-02T00:00:01.000Z');
  });
});
