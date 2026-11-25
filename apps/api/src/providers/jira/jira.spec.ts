import { createHmac } from 'node:crypto';

import { parseJiraWebhook, JiraProvider } from './jira.provider';
import {
  detectStoryPointsField,
  jqlFor,
  mapJiraIssue,
  mapJiraPriority,
  mapJiraStatus,
  startedAtOf,
  type JiraIssue,
} from './mappers';

describe('Jira mappers', () => {
  it.each([
    ['new', null, 'TODO'],
    ['indeterminate', null, 'IN_PROGRESS'],
    ['done', 'Done', 'DONE'],
    ['done', null, 'DONE'],
    ['done', "Won't Do", 'CANCELLED'],
    ['done', 'Won’t Fix', 'CANCELLED'],
    ['done', 'Duplicate', 'CANCELLED'],
    [undefined, null, 'TODO'],
  ] as const)('status category %s + resolution %s → %s', (category, resolution, expected) => {
    expect(mapJiraStatus(category, resolution)).toBe(expected);
  });

  it.each([
    ['Highest', 'URGENT'],
    ['Blocker', 'URGENT'],
    ['High', 'HIGH'],
    ['Major', 'HIGH'],
    ['Medium', 'MEDIUM'],
    ['Low', 'LOW'],
    ['Lowest', 'LOW'],
    ['Trivial', 'LOW'],
    ['Custom', 'NONE'],
    [null, 'NONE'],
  ] as const)('priority %s → %s', (name, expected) => {
    expect(mapJiraPriority(name)).toBe(expected);
  });

  it('discovers the story points field (Software schema first)', () => {
    expect(
      detectStoryPointsField([
        { id: 'customfield_1', name: 'Story Points', custom: true, schema: { custom: 'x:float' } },
        {
          id: 'customfield_10016',
          name: 'Story point estimate',
          custom: true,
          schema: { custom: 'com.pyxis.greenhopper.jira:jsw-story-points' },
        },
        { id: 'summary', name: 'Summary', custom: false },
      ]),
    ).toBe('customfield_10016');
    expect(detectStoryPointsField([{ id: 'customfield_2', name: 'Story Points' }])).toBe(
      'customfield_2',
    );
    expect(detectStoryPointsField([{ id: 'summary', name: 'Summary' }])).toBeNull();
  });

  const categories = new Map([
    ['1', 'new'],
    ['3', 'indeterminate'],
    ['10001', 'done'],
  ]);
  const issue: JiraIssue = {
    id: '10042',
    key: 'PAY-42',
    fields: {
      summary: 'Support annual plans',
      status: { id: '10001', name: 'Done', statusCategory: { key: 'done' } },
      priority: { name: 'High' },
      labels: ['billing'],
      project: { key: 'PAY', name: 'Payments' },
      created: '2026-10-01T09:00:00.000+0000',
      updated: '2026-10-05T09:00:00.000+0000',
      resolutiondate: '2026-10-05T08:00:00.000+0000',
      resolution: { name: 'Done' },
      assignee: { accountId: 'acc-1' },
      customfield_10016: 5,
    },
    changelog: {
      histories: [
        {
          created: '2026-10-04T09:00:00.000+0000',
          items: [{ field: 'status', fieldId: 'status', to: '10001' }],
        },
        {
          created: '2026-10-02T09:00:00.000+0000',
          items: [{ field: 'status', fieldId: 'status', to: '3' }],
        },
      ],
    },
  };

  it('takes startedAt from the first move to an in-progress status', () => {
    expect(startedAtOf(issue, categories)?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    expect(startedAtOf({ ...issue, changelog: undefined }, categories)).toBeNull();
  });

  it('maps a completed issue', () => {
    const mapped = mapJiraIssue(issue, {
      site: { id: 'cloud-1', name: 'Acme', url: 'https://acme.atlassian.net/' },
      storyPointsField: 'customfield_10016',
      categories,
    });
    expect(mapped).toMatchObject({
      externalId: 'cloud-1:10042',
      key: 'PAY-42',
      url: 'https://acme.atlassian.net/browse/PAY-42',
      status: 'DONE',
      priority: 'HIGH',
      storyPoints: 5,
      projectKey: 'PAY',
      assigneeExternalId: 'acc-1',
      canceledAt: null,
    });
    expect(mapped.completedAt?.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });

  it('never completes cancelled issues and ignores non-numeric points', () => {
    const mapped = mapJiraIssue(
      {
        ...issue,
        fields: { ...issue.fields, resolution: { name: "Won't Do" }, customfield_10016: '5' },
      },
      {
        site: { id: 'c', name: 'A', url: 'https://a.atlassian.net' },
        storyPointsField: 'customfield_10016',
        categories,
      },
    );
    expect(mapped.status).toBe('CANCELLED');
    expect(mapped.completedAt).toBeNull();
    expect(mapped.canceledAt).not.toBeNull();
    expect(mapped.storyPoints).toBeNull();
  });

  it('builds a zone-independent JQL window with relative minutes (outward rounding, safe id)', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(
      jqlFor(
        'acc"1) OR 1=1',
        { from: new Date(now - 90 * 60_000), to: new Date(now - 30 * 60_000) },
        now,
      ),
    ).toBe('assignee = "acc1OR11" AND updated >= -91m AND updated <= -30m ORDER BY updated ASC');
  });
});

describe('Jira webhooks', () => {
  const secret = 'jira-secret';
  const provider = new JiraProvider(
    {} as never,
    {
      get: (key: string) => (key === 'JIRA_WEBHOOK_SECRET' ? secret : undefined),
    } as never,
  );

  it('verifies X-Hub-Signature sha256 and fails closed', () => {
    const body = Buffer.from('{"webhookEvent":"jira:issue_updated"}');
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(provider.verifyWebhook(body, `sha256=${sig}`)).toBe(true);
    expect(provider.verifyWebhook(body, `sha256=${'0'.repeat(64)}`)).toBe(false);
    expect(provider.verifyWebhook(body, sig)).toBe(false);
    expect(provider.verifyWebhook(body, undefined)).toBe(false);
  });

  it('maps issue events to the assignees before/after and the site origin', () => {
    expect(
      parseJiraWebhook('jira:issue_updated', {
        issue: {
          self: 'https://acme.atlassian.net/rest/api/3/issue/1',
          fields: { assignee: { accountId: 'b' } },
        },
        changelog: { items: [{ field: 'assignee', from: 'a', to: 'b' }] },
      }),
    ).toEqual({
      kind: 'activity_changed',
      provider: 'jira',
      accountExternalIds: ['b', 'a'],
      repositoryExternalIds: [],
      siteId: 'https://acme.atlassian.net',
    });
    expect(parseJiraWebhook('jira:issue_updated', { issue: { fields: {} } }).kind).toBe('ignored');
    expect(parseJiraWebhook('comment_created', {}).kind).toBe('ignored');
  });
});
