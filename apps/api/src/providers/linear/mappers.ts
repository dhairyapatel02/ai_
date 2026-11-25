import type {
  NormalizedIssue,
  NormalizedIssuePriority,
  NormalizedIssueStatus,
} from '@devimpact/shared';

/** Pure Linear → normalised issue mappers (P13, D-030). */

export interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  url?: string | null;
  priority?: number | null;
  estimate?: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  state?: { type?: string | null; name?: string | null } | null;
  labels?: { nodes?: { name: string }[] } | null;
  team?: { key?: string | null; name?: string | null } | null;
  project?: { name?: string | null } | null;
  cycle?: { number?: number | null; name?: string | null } | null;
  assignee?: { id?: string | null } | null;
}

/** Workflow state *type*: triage/backlog/unstarted → TODO, started, completed, canceled. */
export function mapLinearStatus(type: string | null | undefined): NormalizedIssueStatus {
  switch (type) {
    case 'started':
      return 'IN_PROGRESS';
    case 'completed':
      return 'DONE';
    case 'canceled':
    case 'duplicate':
      return 'CANCELLED';
    default:
      return 'TODO';
  }
}

/** Linear priority 0 = none, 1 = urgent, 2 = high, 3 = medium ("normal"), 4 = low. */
export function mapLinearPriority(value: number | null | undefined): NormalizedIssuePriority {
  switch (value) {
    case 1:
      return 'URGENT';
    case 2:
      return 'HIGH';
    case 3:
      return 'MEDIUM';
    case 4:
      return 'LOW';
    default:
      return 'NONE';
  }
}

const date = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

export function mapLinearIssue(
  node: LinearIssueNode,
  organizationId: string | null,
): NormalizedIssue {
  const status = mapLinearStatus(node.state?.type);
  const completed = date(node.completedAt);
  const cycle = node.cycle
    ? (node.cycle.name ?? (node.cycle.number != null ? `Cycle ${node.cycle.number}` : null))
    : null;
  return {
    externalId: node.id,
    key: node.identifier,
    url: node.url ?? null,
    title: node.title.slice(0, 500),
    labels: (node.labels?.nodes ?? []).map((l) => l.name).slice(0, 30),
    storyPoints:
      typeof node.estimate === 'number' && Number.isFinite(node.estimate) ? node.estimate : null,
    priority: mapLinearPriority(node.priority),
    status,
    statusName: node.state?.name ?? null,
    projectKey: node.team?.key ?? null,
    projectName: node.project?.name ?? node.team?.name ?? null,
    cycleName: cycle,
    siteId: organizationId,
    assigneeExternalId: node.assignee?.id ?? null,
    createdAt: new Date(node.createdAt),
    updatedAt: new Date(node.updatedAt),
    startedAt: date(node.startedAt),
    completedAt: status === 'DONE' ? (completed ?? new Date(node.updatedAt)) : null,
    canceledAt: status === 'CANCELLED' ? (date(node.canceledAt) ?? new Date(node.updatedAt)) : null,
  };
}

/** Issues assigned to the viewer, by `updatedAt` window (GraphQL; ~1 complexity point per node). */
export const LINEAR_ISSUES_QUERY = `query DevImpactIssues($assignee: ID!, $from: DateTimeOrDuration!, $to: DateTimeOrDuration!, $after: String) {
  issues(
    first: 50
    after: $after
    includeArchived: true
    orderBy: updatedAt
    filter: { assignee: { id: { eq: $assignee } }, updatedAt: { gte: $from, lte: $to } }
  ) {
    nodes {
      id identifier title url priority estimate createdAt updatedAt startedAt completedAt canceledAt
      state { type name }
      labels(first: 20) { nodes { name } }
      team { key name }
      project { name }
      cycle { number name }
      assignee { id }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const LINEAR_VIEWER_QUERY = `query DevImpactViewer {
  viewer { id name displayName email avatarUrl organization { id name urlKey } }
}`;
