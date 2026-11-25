/**
 * Provider abstraction for activity sources (ADR-0007 §Provider abstraction, D-029/D-030). The
 * sync orchestrator depends only on these types. Code hosts (`GitHubProvider`, `GitLabProvider`)
 * implement `ActivityProvider`; issue trackers (`JiraProvider`, `LinearProvider`) implement
 * `IssueTrackerProvider`. Both share `ProviderBase` (token lifecycle, OAuth, webhooks).
 *
 * All timestamps are `Date`s in UTC. DTOs carry only what the data model stores (no third-party
 * review content, no bodies of other people's PRs — ARCHITECTURE_V2 §12).
 */

export const PROVIDER_KINDS = ['github', 'gitlab', 'jira', 'linear'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
/** `code` = repositories, PRs/MRs, reviews, commits; `issues` = issue-tracker work items. */
export type ProviderCategory = 'code' | 'issues';
export const PROVIDER_CATEGORY: Record<ProviderKind, ProviderCategory> = {
  github: 'code',
  gitlab: 'code',
  jira: 'issues',
  linear: 'issues',
};
export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  jira: 'Jira',
  linear: 'Linear',
};
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
  /** Emails the provider reports as verified for this account (identity linking, D-030). */
  verifiedEmails?: string[];
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
  | {
      /**
       * GitLab / Jira / Linear: something changed for these accounts or projects; the worker runs
       * an incremental sync of each matching integration (cheap: cursor − 1 h).
       */
      kind: 'activity_changed';
      provider: Exclude<ProviderKind, 'github'>;
      accountExternalIds: string[];
      repositoryExternalIds: string[];
      /** Jira cloudId / Linear organization id (narrows the match), else null. */
      siteId: string | null;
    }
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
  /** Self-managed instance origin (GitLab); null/undefined = provider default. */
  baseUrl?: string | null;
  /** `Integration.config` (Jira sites + story points field, Linear organization, …). */
  config?: Record<string, unknown>;
  /** Linked identities used to match commits (GitLab author emails, D-030). */
  identities?: { emails: string[]; usernames: string[] };
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

/** Token lifecycle + webhooks, common to every provider. */
export interface ProviderBase {
  readonly kind: ProviderKind;
  readonly category: ProviderCategory;
  /** `baseUrl` = self-managed GitLab origin; ignored by other providers. */
  refreshToken(refreshToken: string, baseUrl?: string | null): Promise<ProviderTokenSet>;
  /** Revokes at the provider where supported; false when not supported or it failed. */
  revokeToken(accessToken: string, baseUrl?: string | null): Promise<boolean>;
  /**
   * Timing-safe authenticity check over the raw body. `signatureHeader` is the provider's header
   * (GitHub/Jira `X-Hub-Signature(-256)`, Linear `Linear-Signature`, GitLab `X-Gitlab-Token`).
   */
  verifyWebhook(rawBody: Uint8Array, signatureHeader: string | undefined): boolean;
  parseWebhook(event: string, payload: unknown): ProviderWebhookEvent;
}

export interface ActivityProvider extends ProviderBase {
  readonly category: 'code';
  openSession(options: ProviderSessionOptions): ProviderSession;
  /** Repositories an installation grants (installation token; ADR-0004 metadata use). */
  installationRepositories(installationId: string): Promise<NormalizedRepository[]>;
}

// ── Issue trackers (Jira, Linear — P13) ───────────────────────────────────────────────────────

export type NormalizedIssueStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type NormalizedIssuePriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/** An issue assigned to the connected user. Titles only — descriptions/comments are never read. */
export interface NormalizedIssue {
  externalId: string;
  /** Human key: Jira `ABC-123`, Linear `ENG-42`. */
  key: string;
  url: string | null;
  title: string;
  labels: string[];
  storyPoints: number | null;
  priority: NormalizedIssuePriority;
  status: NormalizedIssueStatus;
  statusName: string | null;
  projectKey: string | null;
  projectName: string | null;
  cycleName: string | null;
  siteId: string | null;
  assigneeExternalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  /** Set only when `status = DONE` (KPI §3.6). */
  completedAt: Date | null;
  canceledAt: Date | null;
}

export interface IssueTrackerSession {
  readonly stats: ProviderStats;
  getAccount(): Promise<ProviderAccount>;
  /**
   * Discovers what the stream needs (Jira sites, status categories, story points field; Linear
   * organization) and returns the config to persist on the integration.
   */
  prepare(): Promise<Record<string, unknown>>;
  /** Issues assigned to `accountExternalId` updated within `window`, oldest update first. */
  issues(accountExternalId: string, window: TimeWindow): AsyncIterable<SearchPage<NormalizedIssue>>;
}

export interface IssueTrackerProvider extends ProviderBase {
  readonly category: 'issues';
  openSession(options: ProviderSessionOptions): IssueTrackerSession;
}

export type AnyProvider = ActivityProvider | IssueTrackerProvider;

// ── OAuth (GitLab, Jira, Linear; GitHub uses its App client) ─────────────────────────────────

export interface OAuthAuthorizeRequest {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  baseUrl?: string | null;
}

export interface OAuthExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  baseUrl?: string | null;
}

/** OAuth client of a provider (authorization code grant; PKCE where the provider supports it). */
export interface ProviderOAuthClient {
  readonly kind: Exclude<ProviderKind, 'github'>;
  /** Whether the authorize URL carries an S256 challenge (Jira 3LO: signed state + secret only). */
  readonly usesPkce: boolean;
  configured(): boolean;
  authorizeUrl(request: OAuthAuthorizeRequest): string;
  exchangeCode(request: OAuthExchangeRequest): Promise<ProviderTokenSet>;
  /** Account behind a fresh token (plus verified emails where the scope allows). */
  account(accessToken: string, baseUrl?: string | null): Promise<ProviderAccount>;
  /** Where the user manages the authorization at the provider (S19 "Manage"). */
  manageUrl(baseUrl?: string | null): string;
}
