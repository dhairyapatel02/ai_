/**
 * Stable, human-readable evidence refs (API_CONTRACT_V2 §3.3, KPI_METHODOLOGY §7):
 * `PR-<owner>/<repo>#<number>`, `REV-<owner>/<repo>#<number>`, `C-<owner>/<repo>@<sha7>`.
 */
export const prRef = (fullName: string, number: number) => `PR-${fullName}#${number}`;
export const reviewRef = (fullName: string, number: number) => `REV-${fullName}#${number}`;
export const commitRef = (fullName: string, sha: string) => `C-${fullName}@${sha.slice(0, 7)}`;

/** Only http(s) URLs are returned to clients (stored values come from GitHub). */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function commitUrl(htmlUrl: string | null, sha: string): string | null {
  const base = safeUrl(htmlUrl);
  return base ? `${base.replace(/\/$/, '')}/commit/${encodeURIComponent(sha)}` : null;
}
