'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImpactScoreCard } from '@/components/impact-score-card';
import { GitCommit, GitPullRequest, Eye, TrendingUp, FileText, ClipboardList } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  // Mock data - will be replaced with API calls
  const stats = {
    commits: 142,
    prsMerged: 28,
    reviewsDone: 45,
    impactScore: 78,
  };

  const recentActivity = [
    { type: 'commit', message: 'feat: Add user authentication flow', repo: 'myapp/backend', time: '2h ago' },
    { type: 'pr', message: 'Implement dashboard analytics', repo: 'myapp/frontend', time: '5h ago' },
    { type: 'review', message: 'Review: API rate limiting', repo: 'myapp/backend', time: '1d ago' },
    { type: 'commit', message: 'fix: Resolve memory leak in worker', repo: 'myapp/worker', time: '1d ago' },
    { type: 'pr', message: 'Add export functionality', repo: 'myapp/frontend', time: '2d ago' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Your engineering impact at a glance</p>
        </div>
        <div className="flex gap-2">
          <Link href="/resume">
            <Button variant="outline" className="gap-2">
              <FileText className="h-4 w-4" />
              Generate Resume
            </Button>
          </Link>
          <Link href="/appraisal">
            <Button className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Generate Appraisal
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commits This Month</CardTitle>
            <GitCommit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.commits}</div>
            <p className="text-xs text-muted-foreground">+12% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">PRs Merged</CardTitle>
            <GitPullRequest className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.prsMerged}</div>
            <p className="text-xs text-muted-foreground">+4 from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reviews Done</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.reviewsDone}</div>
            <p className="text-xs text-muted-foreground">+8 from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Impact Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.impactScore}/100</div>
            <p className="text-xs text-muted-foreground">Strong performer</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Impact Score */}
        <ImpactScoreCard
          score={stats.impactScore}
          breakdown={{
            featureDelivery: 82,
            codeQuality: 75,
            collaboration: 80,
            leadership: 65,
          }}
        />

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1">
                    {item.type === 'commit' && <GitCommit className="h-4 w-4 text-green-500" />}
                    {item.type === 'pr' && <GitPullRequest className="h-4 w-4 text-purple-500" />}
                    {item.type === 'review' && <Eye className="h-4 w-4 text-blue-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.message}</p>
                    <p className="text-xs text-muted-foreground">{item.repo} &middot; {item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
