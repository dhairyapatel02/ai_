import { createHmac } from 'node:crypto';

import { LinearProvider, parseLinearWebhook } from './linear.provider';
import { mapLinearIssue, mapLinearPriority, mapLinearStatus } from './mappers';

describe('Linear mappers', () => {
  it.each([
    ['triage', 'TODO'],
    ['backlog', 'TODO'],
    ['unstarted', 'TODO'],
    ['started', 'IN_PROGRESS'],
    ['completed', 'DONE'],
    ['canceled', 'CANCELLED'],
    ['duplicate', 'CANCELLED'],
    [null, 'TODO'],
  ] as const)('state type %s → %s', (type, expected) => {
    expect(mapLinearStatus(type)).toBe(expected);
  });

  it.each([
    [0, 'NONE'],
    [1, 'URGENT'],
    [2, 'HIGH'],
    [3, 'MEDIUM'],
    [4, 'LOW'],
    [null, 'NONE'],
  ] as const)('priority %s → %s', (value, expected) => {
    expect(mapLinearPriority(value)).toBe(expected);
  });

  const node = {
    id: 'iss-1',
    identifier: 'ENG-42',
    title: 'Speed up checkout',
    url: 'https://linear.app/acme/issue/ENG-42',
    priority: 2,
    estimate: 3,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
    startedAt: '2026-10-02T00:00:00Z',
    completedAt: '2026-10-04T00:00:00Z',
    state: { type: 'completed', name: 'Done' },
    labels: { nodes: [{ name: 'perf' }] },
    team: { key: 'ENG', name: 'Engineering' },
    project: { name: 'Checkout' },
    cycle: { number: 12, name: null },
    assignee: { id: 'user-1' },
  };

  it('maps estimate → story points, team key, cycle and completion', () => {
    expect(mapLinearIssue(node, 'org-1')).toMatchObject({
      externalId: 'iss-1',
      key: 'ENG-42',
      storyPoints: 3,
      priority: 'HIGH',
      status: 'DONE',
      projectKey: 'ENG',
      projectName: 'Checkout',
      cycleName: 'Cycle 12',
      siteId: 'org-1',
      labels: ['perf'],
      completedAt: new Date('2026-10-04T00:00:00Z'),
      canceledAt: null,
    });
  });

  it('keeps completedAt null for cancelled issues', () => {
    const mapped = mapLinearIssue(
      {
        ...node,
        state: { type: 'canceled', name: 'Canceled' },
        canceledAt: '2026-10-03T00:00:00Z',
        estimate: null,
      },
      null,
    );
    expect(mapped.completedAt).toBeNull();
    expect(mapped.canceledAt).toEqual(new Date('2026-10-03T00:00:00Z'));
    expect(mapped.storyPoints).toBeNull();
  });
});

describe('Linear webhooks', () => {
  const secret = 'linear-secret';
  const provider = new LinearProvider(
    {} as never,
    {
      get: (key: string) => (key === 'LINEAR_WEBHOOK_SECRET' ? secret : undefined),
    } as never,
  );
  const now = Date.parse('2026-10-10T12:00:00Z');
  const sign = (body: Buffer) => createHmac('sha256', secret).update(body).digest('hex');

  it('verifies the HMAC and the 60 s timestamp window (replay protection)', () => {
    const fresh = Buffer.from(JSON.stringify({ type: 'Issue', webhookTimestamp: now - 5000 }));
    expect(provider.verifyWebhook(fresh, sign(fresh), now)).toBe(true);
    const stale = Buffer.from(JSON.stringify({ type: 'Issue', webhookTimestamp: now - 61_000 }));
    expect(provider.verifyWebhook(stale, sign(stale), now)).toBe(false);
    const noTs = Buffer.from(JSON.stringify({ type: 'Issue' }));
    expect(provider.verifyWebhook(noTs, sign(noTs), now)).toBe(false);
    expect(provider.verifyWebhook(fresh, 'f'.repeat(64), now)).toBe(false);
    expect(provider.verifyWebhook(fresh, undefined, now)).toBe(false);
  });

  it('maps Issue events to old/new assignees within the organization', () => {
    expect(
      parseLinearWebhook('Issue', {
        type: 'Issue',
        action: 'update',
        organizationId: 'org-1',
        data: { assigneeId: 'u2' },
        updatedFrom: { assigneeId: 'u1' },
      }),
    ).toEqual({
      kind: 'activity_changed',
      provider: 'linear',
      accountExternalIds: ['u2', 'u1'],
      repositoryExternalIds: [],
      siteId: 'org-1',
    });
    expect(parseLinearWebhook('Comment', { type: 'Comment' }).kind).toBe('ignored');
    expect(parseLinearWebhook('Issue', { type: 'Issue', data: {} }).kind).toBe('ignored');
  });
});
