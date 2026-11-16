import { createHmac, timingSafeEqual } from 'node:crypto';

import { mapRepository } from './mappers';

import type { NormalizedRepository, ProviderWebhookEvent } from '@devimpact/shared';

/**
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, rawBody)>`, compared in constant time.
 * Missing secret or header → invalid (fail closed).
 */
export function verifyGitHubSignature(
  secret: string | undefined,
  rawBody: Uint8Array,
  header: string | undefined,
): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface WebhookRepo {
  node_id: string;
  full_name: string;
  name: string;
  private: boolean;
  fork?: boolean;
  archived?: boolean;
  html_url?: string;
  default_branch?: string;
  owner?: { login: string };
}

interface WebhookUser {
  login?: string;
  node_id?: string;
  type?: string;
}

function repo(r: WebhookRepo, installationId: string | null): NormalizedRepository {
  return mapRepository(
    {
      id: r.node_id,
      nameWithOwner: r.full_name,
      name: r.name,
      owner: { login: r.owner?.login ?? r.full_name.split('/')[0] ?? '' },
      isPrivate: r.private,
      isFork: r.fork ?? false,
      isArchived: r.archived ?? false,
      url: r.html_url ?? null,
      defaultBranchRef: r.default_branch ? { name: r.default_branch } : null,
    },
    installationId,
  );
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** Normalises the GitHub App events DevImpact handles (ARCHITECTURE_V2 §6.4); the rest → ignored. */
export function parseGitHubWebhook(event: string, payload: unknown): ProviderWebhookEvent {
  const body = asObject(payload);
  const action = typeof body.action === 'string' ? body.action : '';
  const installation = asObject(body.installation);
  const installationId =
    typeof installation.id === 'number' || typeof installation.id === 'string'
      ? String(installation.id)
      : null;
  const sender = asObject(body.sender) as WebhookUser;
  const repository = body.repository as WebhookRepo | undefined;

  switch (event) {
    case 'pull_request': {
      const handled = [
        'opened',
        'edited',
        'closed',
        'reopened',
        'ready_for_review',
        'converted_to_draft',
        'synchronize',
      ];
      const pr = asObject(body.pull_request);
      if (!handled.includes(action) || !repository || typeof pr.number !== 'number') {
        return { kind: 'ignored', reason: `pull_request.${action}` };
      }
      const author = asObject(pr.user) as WebhookUser;
      return {
        kind: 'pull_request',
        action,
        installationId,
        repository: repo(repository, installationId),
        number: pr.number,
        authorExternalId: author.node_id ?? null,
        authorLogin: author.login ?? null,
      };
    }
    case 'pull_request_review': {
      const pr = asObject(body.pull_request);
      const review = asObject(body.review);
      if (
        !['submitted', 'edited', 'dismissed'].includes(action) ||
        !repository ||
        typeof pr.number !== 'number'
      ) {
        return { kind: 'ignored', reason: `pull_request_review.${action}` };
      }
      const reviewer = asObject(review.user) as WebhookUser;
      const author = asObject(pr.user) as WebhookUser;
      return {
        kind: 'pull_request_review',
        action,
        installationId,
        repository: repo(repository, installationId),
        number: pr.number,
        reviewerExternalId: reviewer.node_id ?? null,
        reviewerLogin: reviewer.login ?? null,
        authorExternalId: author.node_id ?? null,
        authorLogin: author.login ?? null,
      };
    }
    case 'push': {
      if (!repository) return { kind: 'ignored', reason: 'push without repository' };
      const ref = typeof body.ref === 'string' ? body.ref : '';
      const defaultBranch = repository.default_branch ?? asObject(repository).master_branch;
      if (ref !== `refs/heads/${String(defaultBranch)}`) {
        return { kind: 'ignored', reason: 'push to a non-default branch' };
      }
      const commits = Array.isArray(body.commits) ? body.commits.map(asObject) : [];
      const logins = new Set<string>();
      let earliest: number | null = null;
      for (const c of commits) {
        const author = asObject(c.author);
        if (typeof author.username === 'string') logins.add(author.username);
        const t = typeof c.timestamp === 'string' ? Date.parse(c.timestamp) : NaN;
        if (!Number.isNaN(t)) earliest = earliest === null ? t : Math.min(earliest, t);
      }
      if (logins.size === 0)
        return { kind: 'ignored', reason: 'push without attributable commits' };
      return {
        kind: 'push',
        installationId,
        repository: repo(repository, installationId),
        authorLogins: [...logins],
        earliestCommitAt: earliest === null ? null : new Date(earliest),
      };
    }
    case 'installation':
    case 'installation_repositories': {
      if (!installationId) return { kind: 'ignored', reason: `${event} without installation` };
      const account = asObject(installation.account) as WebhookUser;
      const list = (key: string) =>
        (Array.isArray(body[key]) ? (body[key] as WebhookRepo[]) : []).map((r) =>
          repo({ ...r, owner: { login: r.full_name.split('/')[0] ?? '' } }, installationId),
        );
      return {
        kind: 'installation',
        action: event === 'installation' ? action : `repositories_${action}`,
        installationId,
        senderExternalId: sender.node_id ?? null,
        installation: {
          installationId,
          accountLogin: account.login ?? 'unknown',
          accountType: account.type === 'Organization' ? 'Organization' : 'User',
          repositorySelection:
            installation.repository_selection === 'selected' ? 'selected' : 'all',
          suspendedAt:
            typeof installation.suspended_at === 'string'
              ? new Date(installation.suspended_at)
              : null,
        },
        repositoriesAdded: [...list('repositories'), ...list('repositories_added')].filter(
          () => action !== 'deleted',
        ),
        repositoriesRemoved: list('repositories_removed'),
      };
    }
    case 'github_app_authorization':
      return action === 'revoked'
        ? { kind: 'authorization_revoked', senderExternalId: sender.node_id ?? null }
        : { kind: 'ignored', reason: `github_app_authorization.${action}` };
    default:
      return { kind: 'ignored', reason: event };
  }
}
