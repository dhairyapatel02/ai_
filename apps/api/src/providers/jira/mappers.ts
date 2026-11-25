import type {
  NormalizedIssue,
  NormalizedIssuePriority,
  NormalizedIssueStatus,
} from '@devimpact/shared';

/**
 * Pure Jira Cloud → normalised issue mappers (P13, D-030). Status comes from the status
 * *category* (`new` / `indeterminate` / `done`), so custom workflows map without configuration;
 * "done" issues with a won't-do style resolution are CANCELLED (never counted as completed).
 */

export interface JiraSite {
  id: string;
  name: string;
  url: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    status?: { id?: string; name?: string; statusCategory?: { key?: string } };
    priority?: { name?: string } | null;
    labels?: string[];
    project?: { key?: string; name?: string };
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    statuscategorychangedate?: string | null;
    resolution?: { name?: string } | null;
    assignee?: { accountId?: string } | null;
  };
  changelog?: {
    histories?: {
      created: string;
      items?: { field?: string; fieldId?: string; to?: string | null }[];
    }[];
  };
}

export interface JiraField {
  id: string;
  name: string;
  custom?: boolean;
  schema?: { type?: string; custom?: string };
}

/** Resolutions that close an issue without completing it (lower-case, ’ normalised). */
const CANCEL_RESOLUTIONS = new Set([
  "won't do",
  "won't fix",
  'duplicate',
  'cannot reproduce',
  'declined',
  'rejected',
  'obsolete',
  'incomplete',
  'abandoned',
]);

export function mapJiraStatus(
  categoryKey: string | undefined,
  resolution: string | null | undefined,
): NormalizedIssueStatus {
  if (categoryKey === 'done') {
    const normalized = (resolution ?? '').toLowerCase().replace(/[’`]/g, "'").trim();
    return CANCEL_RESOLUTIONS.has(normalized) ? 'CANCELLED' : 'DONE';
  }
  if (categoryKey === 'indeterminate') return 'IN_PROGRESS';
  return 'TODO';
}

export function mapJiraPriority(name: string | null | undefined): NormalizedIssuePriority {
  switch ((name ?? '').toLowerCase()) {
    case 'highest':
    case 'blocker':
    case 'critical':
      return 'URGENT';
    case 'high':
    case 'major':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
    case 'lowest':
    case 'minor':
    case 'trivial':
      return 'LOW';
    default:
      return 'NONE';
  }
}

const STORY_POINT_NAMES = ['story points', 'story point estimate'];
const STORY_POINT_SCHEMAS = new Set([
  'com.pyxis.greenhopper.jira:jsw-story-points',
  'com.atlassian.jira.plugin.system.customfieldtypes:float',
]);

/**
 * Story points field discovery: the Jira Software field (`jsw-story-points`, company-managed
 * "Story Points" or team-managed "Story point estimate"), preferring the Software schema.
 */
export function detectStoryPointsField(fields: JiraField[]): string | null {
  const candidates = fields.filter(
    (f) => f.custom !== false && STORY_POINT_NAMES.includes(f.name.trim().toLowerCase()),
  );
  const software = candidates.find(
    (f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:jsw-story-points',
  );
  const numeric = candidates.find(
    (f) => f.schema?.custom && STORY_POINT_SCHEMAS.has(f.schema.custom),
  );
  return (software ?? numeric ?? candidates[0])?.id ?? null;
}

const date = (value: unknown): Date | null =>
  typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value))
    ? new Date(value)
    : null;

/** First move into an in-progress (`indeterminate`) status, from the changelog. */
export function startedAtOf(issue: JiraIssue, categories: Map<string, string>): Date | null {
  let earliest: Date | null = null;
  for (const history of issue.changelog?.histories ?? []) {
    for (const item of history.items ?? []) {
      const isStatus = item.fieldId === 'status' || item.field === 'status';
      if (!isStatus || !item.to) continue;
      const category = categories.get(item.to);
      if (category !== 'indeterminate' && category !== 'done') continue;
      const at = date(history.created);
      // A direct move to done counts as starting then (cycle time 0) only if nothing earlier.
      if (at && (earliest === null || at < earliest) && category === 'indeterminate') earliest = at;
    }
  }
  return earliest;
}

export function mapJiraIssue(
  issue: JiraIssue,
  options: { site: JiraSite; storyPointsField: string | null; categories: Map<string, string> },
): NormalizedIssue {
  const f = issue.fields;
  const status = mapJiraStatus(f.status?.statusCategory?.key, f.resolution?.name);
  const updated = date(f.updated) ?? date(f.created) ?? new Date(0);
  const closedAt = date(f.resolutiondate) ?? date(f.statuscategorychangedate) ?? updated;
  const rawPoints = options.storyPointsField ? f[options.storyPointsField] : null;
  return {
    externalId: `${options.site.id}:${issue.id}`,
    key: issue.key,
    url: `${options.site.url.replace(/\/+$/, '')}/browse/${encodeURIComponent(issue.key)}`,
    title: (f.summary ?? issue.key).slice(0, 500),
    labels: (f.labels ?? []).slice(0, 30),
    storyPoints: typeof rawPoints === 'number' && Number.isFinite(rawPoints) ? rawPoints : null,
    priority: mapJiraPriority(f.priority?.name),
    status,
    statusName: f.status?.name ?? null,
    projectKey: f.project?.key ?? null,
    projectName: f.project?.name ?? null,
    cycleName: null,
    siteId: options.site.id,
    assigneeExternalId: f.assignee?.accountId ?? null,
    createdAt: date(f.created) ?? updated,
    updatedAt: updated,
    startedAt: startedAtOf(issue, options.categories),
    completedAt: status === 'DONE' ? closedAt : null,
    canceledAt: status === 'CANCELLED' ? closedAt : null,
  };
}

/**
 * JQL window as *relative minutes* (`updated >= -90m`): Jira interprets absolute JQL dates in the
 * user's profile time zone, relative ones are zone-independent. Rounded outwards (idempotent).
 */
export function jqlFor(
  accountId: string,
  window: { from: Date; to: Date },
  now = Date.now(),
): string {
  const fromMin = Math.ceil((now - window.from.getTime()) / 60_000) + 1;
  const toMin = Math.max(0, Math.floor((now - window.to.getTime()) / 60_000));
  const safeId = accountId.replace(/[^A-Za-z0-9:_-]/g, '');
  return `assignee = "${safeId}" AND updated >= -${fromMin}m AND updated <= -${toMin}m ORDER BY updated ASC`;
}
