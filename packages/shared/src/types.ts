import { Plan, Provider, DocumentType, PRState, CommitCategory, AppraisalPeriod } from './enums';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  plan: Plan;
  createdAt: Date;
}

export interface Integration {
  id: string;
  userId: string;
  provider: Provider;
  accessToken: string;
  refreshToken: string | null;
  metadata: Record<string, unknown>;
}

export interface Commit {
  id: string;
  userId: string;
  integrationId: string;
  sha: string;
  message: string;
  repo: string;
  branch: string;
  additions: number;
  deletions: number;
  timestamp: Date;
}

export interface PullRequest {
  id: string;
  userId: string;
  integrationId: string;
  title: string;
  body: string | null;
  state: PRState;
  repo: string;
  mergedAt: Date | null;
  reviewCount: number;
  timestamp: Date;
}

export interface Issue {
  id: string;
  userId: string;
  integrationId: string;
  title: string;
  labels: string[];
  storyPoints: number | null;
  priority: string;
  status: string;
  projectName: string | null;
  timestamp: Date;
}

export interface CodeReview {
  id: string;
  userId: string;
  prId: string;
  comments: number;
  approved: boolean;
  timestamp: Date;
}

export interface GeneratedDocument {
  id: string;
  userId: string;
  type: DocumentType;
  content: Record<string, unknown>;
  dateRange: { from: string; to: string };
  createdAt: Date;
}

export interface ImpactScore {
  id: string;
  userId: string;
  month: number;
  year: number;
  overall: number;
  featureDelivery: number;
  codeQuality: number;
  collaboration: number;
  leadership: number;
}

export interface EnhancedCommitResult {
  enhanced: string;
  category: CommitCategory;
}

export interface ResumeBullet {
  text: string;
  category: string;
  impact: string;
}

export interface AppraisalReport {
  executiveSummary: string;
  keyContributions: { title: string; evidence: string }[];
  metrics: { prCount: number; reviewCount: number; featuresShipped: number; commitsCount: number };
  areasOfImpact: string[];
  growthAndLearning: string[];
  goalsForNextPeriod: string[];
}

export interface PromotionPacket {
  whyReady: string;
  leadershipEvidence: string[];
  technicalImpact: string[];
  businessValue: string[];
  mentorship: string[];
  supportingData: Record<string, unknown>;
}

export interface ImpactScoreResult {
  overall: number;
  featureDelivery: number;
  codeQuality: number;
  collaboration: number;
  leadership: number;
  highlights: string[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface GenerateResumeInput {
  dateRange: DateRange;
  role: 'backend' | 'frontend' | 'fullstack' | 'devops' | 'manager';
  format?: 'bullets' | 'narrative';
}

export interface GenerateAppraisalInput {
  period: AppraisalPeriod;
  month: number;
  year: number;
}

export interface GeneratePromotionInput {
  currentRole: string;
  targetRole: string;
}

export interface ActivitySummary {
  totalCommits: number;
  totalPRs: number;
  totalReviews: number;
  totalIssues: number;
  topRepos: { repo: string; commits: number }[];
  impactScore: number | null;
}
