/**
 * Stable, human-readable evidence refs (API_CONTRACT_V2 §3.3 + §22 A-8, KPI_METHODOLOGY §7, D-030):
 * GitHub `PR-<owner>/<repo>#<n>`, GitLab `MR-<group>/<project>!<n>`, reviews `REV-<repo>#<n>` /
 * `REV-<group>/<project>!<n>`, commits `C-<repo>@<sha7>`, Jira `JIRA-<KEY-123>`, Linear `LIN-<ENG-42>`.
 * `provider` is the Prisma enum or its lower-case wire value; absent = GitHub.
 */
const isGitLab = (provider?: string | null) => provider === 'GITLAB' || provider === 'gitlab';

export const prRef = (fullName: string, number: number, provider?: string | null) =>
  isGitLab(provider) ? `MR-${fullName}!${number}` : `PR-${fullName}#${number}`;
export const reviewRef = (fullName: string, number: number, provider?: string | null) =>
  isGitLab(provider) ? `REV-${fullName}!${number}` : `REV-${fullName}#${number}`;
export const commitRef = (fullName: string, sha: string) => `C-${fullName}@${sha.slice(0, 7)}`;
export const issueRef = (provider: string, key: string) =>
  provider === 'LINEAR' || provider === 'linear' ? `LIN-${key}` : `JIRA-${key}`;

/** Prisma select fragment: the provider of a repository's integration (ref formats). */
export const REPO_PROVIDER = { integration: { select: { provider: true } } } as const;

/** `{ id, fullName, provider }` wire repo ref (P13 adds the provider). */
export function repoRef(repo: {
  id: string;
  fullName: string;
  integration?: { provider: string } | null;
}): { id: string; fullName: string; provider?: 'github' | 'gitlab' | 'jira' | 'linear' } {
  const provider = repo.integration?.provider.toLowerCase() as
    'github' | 'gitlab' | 'jira' | 'linear' | undefined;
  return { id: repo.id, fullName: repo.fullName, ...(provider ? { provider } : {}) };
}

/** Only http(s) URLs are returned to clients (stored values come from the provider). */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function commitUrl(
  htmlUrl: string | null,
  sha: string,
  provider?: string | null,
): string | null {
  const base = safeUrl(htmlUrl);
  if (!base) return null;
  const path = isGitLab(provider) ? '/-/commit/' : '/commit/';
  return `${base.replace(/\/$/, '')}${path}${encodeURIComponent(sha)}`;
}
