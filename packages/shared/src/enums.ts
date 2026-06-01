export enum Plan {
  FREE = 'FREE',
  PRO = 'PRO',
  TEAM = 'TEAM',
  ENTERPRISE = 'ENTERPRISE',
}

export enum Provider {
  GITHUB = 'GITHUB',
  GITLAB = 'GITLAB',
  JIRA = 'JIRA',
  LINEAR = 'LINEAR',
}

export enum DocumentType {
  RESUME = 'RESUME',
  APPRAISAL = 'APPRAISAL',
  PROMOTION = 'PROMOTION',
  KPI = 'KPI',
}

export enum PRState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  MERGED = 'MERGED',
}

export enum IssueStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export enum IssuePriority {
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  NONE = 'NONE',
}

export enum CommitCategory {
  FEATURE = 'feature',
  BUGFIX = 'bugfix',
  REFACTOR = 'refactor',
  PERFORMANCE = 'performance',
  INFRA = 'infra',
}

export enum AppraisalPeriod {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
}

export enum SyncStatus {
  IDLE = 'IDLE',
  SYNCING = 'SYNCING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}
