/**
 * Provider abstraction for activity sources (ADR-0007 §Provider abstraction, D-018). The sync
 * orchestrator depends only on these types; `GitHubProvider` (apps/api/src/providers/github) is the
 * only v2.0 implementation; GitLab/Jira/Linear plug in here in v2.1.
 *
 * All timestamps are `Date`s in UTC. DTOs carry only what the data model stores (no third-party
 * review content, no bodies of other people's PRs — ARCHITECTURE_V2 §12).
 */

export type ProviderKind = 'github';
export type NormalizedPrState = 'OPEN' | 'CLOSED' | 'MERGED';
export type NormalizedReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface ProviderAccount {
  externalId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface ProviderTokenSet {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

export interface NormalizedRepository {
  externalId: string;
  fullName: string;
  ownerLogin: string;
  name: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  htmlUrl: string | null;
  /** Installation that grants access; null = visible as a public repository only. */
  installationId: string | null;
}

export interface NormalizedInstallation {
  installationId: string;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  repositorySelection: 'all' | 'selected';
  suspendedAt: Date | null;
}

export interface NormalizedPullRequest {
  externalId: string;
  repository: NormalizedRepository;
  number: number;
  title: string;
  /** Authored PRs only; always null for PRs the user reviewed. */
  body: string | null;
  url: string | null;
  state: NormalizedPrState;
  isDraft: boolean;
  authorExternalId: string | null;
  authorLogin: string | null;
  labels: string[];
  baseRef: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  mergedAt: Date | null;
  closedAt: Date | null;
  readyForReviewAt: Date | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commitsCount: number | null;
  /** Received-review aggregates (authored PRs; bots and the author excluded). */
  firstReviewAt: Date | null;
  reviewersCount: number | null;
  approvalsCount: number | null;
  changesRequestedCount: number | null;
  isRevert: boolean;
  revertedAt: Date | null;
  revertedByUrl: string | null;
}

/** A review submitted by the connected user. */
export interface NormalizedReview {
  externalId: string;
  state: NormalizedReviewState;
  submittedAt: Date;
  hasBody: boolean;
  commentsCount: number;
  reviewRequestedAt: Date | null;
}

export interface NormalizedReviewedPullRequest {
  pullRequest: NormalizedPullRequest;
  reviews: NormalizedReview[];
}

export interface NormalizedCommit {
  sha: string;
  repositoryExternalId: string;
  messageHeadline: string;
  messageBody: string | null;
  branch: string;
  authoredAt: Date;
  committedAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number | null;
  parentsCount: number;
  associatedPrNumber: number | null;
  authorExternalId: string | null;
}

export interface CommitRepositoryActivity {
  repository: NormalizedRepository;
  commitCount: number;
}

/** One page of a search stream; `total` is the provider's (estimated) result count. */
export interface SearchPage<T> {
  items: T[];
  total: number;
}

export interface CommitRequest {
  repository: NormalizedRepository;
  since: Date;
  until: Date;
}

export interface CommitPage {
  repositoryExternalId: string;
  /** Default branch the history was read from (stored on every commit). */
  branch: string | null;
  items: NormalizedCommit[];
  /** True when this repository has no further pages. */
  done: boolean;
  /** Repository no longer exists or is no longer accessible. */
  notFound?: boolean;
}

export interface ProviderStats {
  requests: number;
  graphqlPoints: number;
  rateLimitRemaining: number | null;
  rateLimitResetAt: Date | null;
}

/** Normalised webhook events the orchestrator acts on (ARCHITECTURE_V2 §6.4). */
export type ProviderWebhookEvent =
  | {
      kind: 'pull_request';
      action: string;
      installationId: string | null;
      repository: NormalizedRepository;
      number: number;
      authorExternalId: string | null;
      authorLogin: string | null;
    }
  | {
      kind: 'pull_request_review';
      action: string;
      installationId: string | null;
      repository: NormalizedRepository;
      number: number;
      reviewerExternalId: string | null;
      reviewerLogin: string | null;
      authorExternalId: string | null;
      authorLogin: string | null;
    }
  | {
      kind: 'push';
      installationId: string | null;
      repository: NormalizedRepository;
      /** Logins and emails-less author identities of the pushed commits (default branch only). */
      authorLogins: string[];
      earliestCommitAt: Date | null;
    }
  | {
      kind: 'installation';
      action: string;
      installationId: string;
      senderExternalId: string | null;
      installation: NormalizedInstallation | null;
      repositoriesAdded: NormalizedRepository[];
      repositoriesRemoved: NormalizedRepository[];
    }
  | { kind: 'authorization_revoked'; senderExternalId: string | null }
  | { kind: 'ignored'; reason: string };

export interface ProviderSessionOptions {
  /** Returns a valid access token (decrypted at call time, refreshed when close to expiry). */
  getAccessToken: () => Promise<string>;
  /** Called once on 401: refresh and return a new token, or null when reconnection is needed. */
  onUnauthorized: () => Promise<string | null>;
  /** Pause (throw a rate-limit error) when the remaining budget drops below this. */
  minRemaining?: number;
  /** Request-pacing key (one per token/integration), so users don't slow each other down. */
  key?: string;
}

/** One authenticated conversation with a provider (one per job, ADR-0007). */
export interface ProviderSession {
  readonly stats: ProviderStats;
  getAccount(): Promise<ProviderAccount>;
  listInstallations(): Promise<NormalizedInstallation[]>;
  listRepositories(installations: NormalizedInstallation[]): Promise<NormalizedRepository[]>;
  authoredPullRequests(
    login: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedPullRequest>>;
  reviewedPullRequests(
    login: string,
    window: TimeWindow,
  ): AsyncIterable<SearchPage<NormalizedReviewedPullRequest>>;
  commitRepositories(login: string, window: TimeWindow): Promise<CommitRepositoryActivity[]>;
  commits(authorExternalId: string, requests: CommitRequest[]): AsyncIterable<CommitPage>;
  /** Single PR refetch (webhooks). `login` decides authored vs reviewed mapping. */
  pullRequest(
    login: string,
    repositoryFullName: string,
    number: number,
  ): Promise<
    | { role: 'authored'; pullRequest: NormalizedPullRequest }
    | { role: 'reviewed'; reviewed: NormalizedReviewedPullRequest }
    | null
  >;
}

export interface ActivityProvider {
  readonly kind: ProviderKind;
  openSession(options: ProviderSessionOptions): ProviderSession;
  refreshToken(refreshToken: string): Promise<ProviderTokenSet>;
  revokeToken(accessToken: string): Promise<boolean>;
  /** Repositories an installation grants (installation token; ADR-0004 metadata use). */
  installationRepositories(installationId: string): Promise<NormalizedRepository[]>;
  /** Timing-safe signature check over the raw body. */
  verifyWebhook(rawBody: Uint8Array, signatureHeader: string | undefined): boolean;
  parseWebhook(event: string, payload: unknown): ProviderWebhookEvent;
}
