import { createHmac } from 'node:crypto';

import { parseGitHubWebhook, verifyGitHubSignature } from './webhook';

const sign = (body: string, secret: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('GitHub webhook helpers', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}');

  it('verifies X-Hub-Signature-256 over the raw bytes and fails closed', () => {
    expect(verifyGitHubSignature('s3cret', body, sign(body.toString(), 's3cret'))).toBe(true);
    expect(verifyGitHubSignature('s3cret', body, sign(body.toString(), 'other'))).toBe(false);
    expect(verifyGitHubSignature('s3cret', body, undefined)).toBe(false);
    expect(verifyGitHubSignature('s3cret', body, 'sha1=abc')).toBe(false);
    expect(verifyGitHubSignature('s3cret', body, 'sha256=00')).toBe(false); // length mismatch
    expect(verifyGitHubSignature(undefined, body, sign(body.toString(), ''))).toBe(false);
  });

  const repository = {
    node_id: 'R1',
    full_name: 'acme/api',
    name: 'api',
    private: true,
    default_branch: 'trunk',
    owner: { login: 'acme' },
  };

  it('normalises pull_request and pull_request_review events; ignores other actions', () => {
    expect(
      parseGitHubWebhook('pull_request', {
        action: 'closed',
        pull_request: { number: 3, user: { login: 'octo', node_id: 'U1' } },
        repository,
        installation: { id: 9 },
      }),
    ).toMatchObject({
      kind: 'pull_request',
      number: 3,
      authorLogin: 'octo',
      installationId: '9',
      repository: { externalId: 'R1', fullName: 'acme/api', installationId: '9' },
    });
    expect(
      parseGitHubWebhook('pull_request', {
        action: 'labeled',
        pull_request: { number: 3 },
        repository,
      }),
    ).toEqual({ kind: 'ignored', reason: 'pull_request.labeled' });
    expect(
      parseGitHubWebhook('pull_request_review', {
        action: 'submitted',
        review: { user: { login: 'octo' } },
        pull_request: { number: 3, user: { login: 'alice' } },
        repository,
      }),
    ).toMatchObject({ kind: 'pull_request_review', reviewerLogin: 'octo', authorLogin: 'alice' });
  });

  it('push: default branch only, attributable commits only', () => {
    const push = {
      ref: 'refs/heads/trunk',
      repository,
      commits: [
        { timestamp: '2026-10-01T00:00:00Z', author: { username: 'octo' } },
        { timestamp: '2026-09-30T00:00:00Z', author: { name: 'no-login' } },
      ],
    };
    expect(parseGitHubWebhook('push', push)).toMatchObject({
      kind: 'push',
      authorLogins: ['octo'],
      earliestCommitAt: new Date('2026-09-30T00:00:00Z'),
    });
    expect(parseGitHubWebhook('push', { ...push, ref: 'refs/heads/feature' }).kind).toBe('ignored');
    expect(parseGitHubWebhook('push', { ...push, commits: [] }).kind).toBe('ignored');
  });

  it('installation events and app authorization revocation', () => {
    expect(
      parseGitHubWebhook('installation_repositories', {
        action: 'removed',
        installation: { id: 5, account: { login: 'acme', type: 'Organization' } },
        repositories_removed: [
          { node_id: 'R2', full_name: 'acme/web', name: 'web', private: true },
        ],
        sender: { node_id: 'U9' },
      }),
    ).toMatchObject({
      kind: 'installation',
      action: 'repositories_removed',
      installationId: '5',
      repositoriesRemoved: [{ externalId: 'R2', fullName: 'acme/web' }],
    });
    expect(
      parseGitHubWebhook('github_app_authorization', {
        action: 'revoked',
        sender: { node_id: 'U1' },
      }),
    ).toEqual({ kind: 'authorization_revoked', senderExternalId: 'U1' });
    expect(parseGitHubWebhook('issues', { action: 'opened' })).toEqual({
      kind: 'ignored',
      reason: 'issues',
    });
  });
});
