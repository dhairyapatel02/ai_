/**
 * GraphQL documents for the GitHub provider (ADR-0007 fetch strategy). Every query selects
 * `rateLimit { cost remaining resetAt }` so budget accounting needs no extra calls.
 * Only fields the data model stores are selected (data minimisation).
 */

const RATE_LIMIT = 'rateLimit { cost remaining resetAt }';

export const REPO_FIELDS = `
  id nameWithOwner name owner { login } isPrivate isFork isArchived url
  defaultBranchRef { name }`;

const PR_CORE = `
  id number title url state isDraft createdAt updatedAt mergedAt closedAt baseRefName
  author { __typename login ... on User { id } ... on Bot { id } }
  repository { ${REPO_FIELDS} }`;

/** Fields for PRs authored by the user: size, labels, received reviews, timeline events. */
export const AUTHORED_PR_FIELDS = `
  ${PR_CORE}
  body additions deletions changedFiles
  commits { totalCount }
  labels(first: 20) { nodes { name } }
  reviews(first: 50) {
    nodes { state submittedAt author { __typename login } }
  }
  timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT, CROSS_REFERENCED_EVENT], first: 20) {
    nodes {
      __typename
      ... on ReadyForReviewEvent { createdAt }
      ... on CrossReferencedEvent {
        createdAt
        source { __typename ... on PullRequest { title url state mergedAt repository { id } } }
      }
    }
  }`;

/** Fields for PRs the user reviewed: metadata only, plus the user's own reviews. */
export const REVIEWED_PR_FIELDS = `
  ${PR_CORE}
  myReviews: reviews(author: $login, first: 20) {
    nodes { id state submittedAt body comments { totalCount } }
  }
  timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 20) {
    nodes {
      __typename
      ... on ReviewRequestedEvent {
        createdAt
        requestedReviewer { __typename ... on User { login } ... on Team { slug } }
      }
    }
  }`;

export const AUTHORED_SEARCH = `
query DevImpactAuthoredPRs($q: String!, $first: Int!, $after: String) {
  ${RATE_LIMIT}
  search(type: ISSUE, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ${AUTHORED_PR_FIELDS} } }
  }
}`;

export const REVIEWED_SEARCH = `
query DevImpactReviewedPRs($q: String!, $first: Int!, $after: String, $login: String!) {
  ${RATE_LIMIT}
  search(type: ISSUE, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ${REVIEWED_PR_FIELDS} } }
  }
}`;

export const COMMIT_REPOSITORIES = `
query DevImpactCommitRepos($login: String!, $from: DateTime!, $to: DateTime!) {
  ${RATE_LIMIT}
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository { ${REPO_FIELDS} }
      }
    }
  }
}`;

/** Single PR (webhooks): authored fields and the user's reviews in one round trip. */
export const SINGLE_PR = `
query DevImpactPullRequest($owner: String!, $name: String!, $number: Int!, $login: String!) {
  ${RATE_LIMIT}
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ${AUTHORED_PR_FIELDS}
      myReviews: reviews(author: $login, first: 20) {
        nodes { id state submittedAt body comments { totalCount } }
      }
      requests: timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 20) {
        nodes {
          __typename
          ... on ReviewRequestedEvent {
            createdAt
            requestedReviewer { __typename ... on User { login } ... on Team { slug } }
          }
        }
      }
    }
  }
}`;

const COMMIT_NODE = `
  oid messageHeadline messageBody authoredDate committedDate additions deletions
  changedFilesIfAvailable parents { totalCount }
  associatedPullRequests(first: 1) { nodes { number } }
  author { user { id } }`;

/**
 * Default-branch history for several repositories in one request (aliases r0..rN). Batching keeps
 * the call count proportional to commit pages, not repositories (budget, ADR-0007).
 */
export function commitHistoryQuery(count: number): string {
  const vars: string[] = ['$author: ID!'];
  const fields: string[] = [];
  for (let i = 0; i < count; i++) {
    vars.push(
      `$o${i}: String!`,
      `$n${i}: String!`,
      `$s${i}: GitTimestamp!`,
      `$u${i}: GitTimestamp!`,
      `$a${i}: String`,
    );
    fields.push(`
  r${i}: repository(owner: $o${i}, name: $n${i}) {
    id
    defaultBranchRef {
      name
      target {
        ... on Commit {
          history(first: 100, after: $a${i}, author: { id: $author }, since: $s${i}, until: $u${i}) {
            pageInfo { hasNextPage endCursor }
            nodes { ${COMMIT_NODE} }
          }
        }
      }
    }
  }`);
  }
  return `query DevImpactCommitHistory(${vars.join(', ')}) {\n  ${RATE_LIMIT}${fields.join('')}\n}`;
}
