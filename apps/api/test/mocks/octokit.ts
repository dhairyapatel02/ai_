/**
 * Jest stand-in for the ESM-only `octokit` package. Tests must never call the real GitHub API:
 * mock GitHubService instead. Any accidental use fails loudly.
 */
export class Octokit {
  constructor() {
    throw new Error('Real Octokit must not be used in tests — mock GitHubService instead.');
  }
}
