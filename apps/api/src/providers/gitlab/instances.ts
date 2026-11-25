import { z } from 'zod';

/** A GitLab instance with its own OAuth application (gitlab.com or self-managed, D-030). */
export interface GitLabInstance {
  /** Origin, e.g. `https://gitlab.example.com` (no trailing slash, no path). */
  url: string;
  clientId: string;
  clientSecret: string;
  label: string;
}

const Instance = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
  label: z.string().min(1).max(60).optional(),
});

/** Normalises to the origin; rejects paths, credentials, queries (they would widen SSRF reach). */
export function originOf(value: string): string | null {
  try {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      (u.pathname !== '/' && u.pathname !== '') ||
      u.search ||
      u.hash
    ) {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

/** Validates `GITLAB_INSTANCES_JSON` (startup + `GitLabInstances`). */
export function parseGitLabInstances(
  json: string | undefined,
): { ok: true; instances: GitLabInstance[] } | { ok: false; error: string } {
  if (!json) return { ok: true, instances: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'must be valid JSON' };
  }
  const parsed = z.array(Instance).max(20).safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  const instances: GitLabInstance[] = [];
  for (const item of parsed.data) {
    const origin = originOf(item.url);
    if (!origin) return { ok: false, error: `${item.url}: use the instance origin only` };
    instances.push({
      url: origin,
      clientId: item.clientId,
      clientSecret: item.clientSecret,
      label: item.label ?? new URL(origin).host,
    });
  }
  return { ok: true, instances };
}
