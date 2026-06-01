'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImpactScoreCard } from '@/components/impact-score-card';
import { TrendingUp, Code2, Users, Shield } from 'lucide-react';

const metrics = {
  productivity: { value: 142, label: 'Commits/Month', trend: '+12%' },
  quality: { value: '2.1', label: 'Avg PR Size (files)', trend: '-8%' },
  collaboration: { value: 45, label: 'Reviews/Month', trend: '+15%' },
  ownership: { value: 8, label: 'Repos Contributed', trend: '+2' },
};

const monthlyTrend = [
  { month: 'Jan', commits: 98, prs: 18, reviews: 32 },
  { month: 'Feb', commits: 112, prs: 22, reviews: 38 },
  { month: 'Mar', commits: 125, prs: 25, reviews: 40 },
  { month: 'Apr', commits: 108, prs: 20, reviews: 35 },
  { month: 'May', commits: 135, prs: 26, reviews: 42 },
  { month: 'Jun', commits: 142, prs: 28, reviews: 45 },
];

export default function KPIsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">KPI Dashboard</h1>
        <p className="text-muted-foreground">Track your engineering performance metrics</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Productivity</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.productivity.value}</div>
            <p className="text-xs text-muted-foreground">{metrics.productivity.label}</p>
            <p className="text-xs text-green-500 mt-1">{metrics.productivity.trend}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Code Quality</CardTitle>
            <Code2 className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.quality.value}</div>
            <p className="text-xs text-muted-foreground">{metrics.quality.label}</p>
            <p className="text-xs text-green-500 mt-1">{metrics.quality.trend} (smaller PRs)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collaboration</CardTitle>
            <Users className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.collaboration.value}</div>
            <p className="text-xs text-muted-foreground">{metrics.collaboration.label}</p>
            <p className="text-xs text-green-500 mt-1">{metrics.collaboration.trend}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ownership</CardTitle>
            <Shield className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.ownership.value}</div>
            <p className="text-xs text-muted-foreground">{metrics.ownership.label}</p>
            <p className="text-xs text-green-500 mt-1">{metrics.ownership.trend}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ImpactScoreCard
          score={78}
          breakdown={{
            featureDelivery: 82,
            codeQuality: 75,
            collaboration: 80,
            leadership: 65,
          }}
        />

        {/* Monthly Trend Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Monthly Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Month</th>
                    <th className="text-right py-2">Commits</th>
                    <th className="text-right py-2">PRs</th>
                    <th className="text-right py-2">Reviews</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyTrend.map((row) => (
                    <tr key={row.month} className="border-b last:border-0">
                      <td className="py-2">{row.month}</td>
                      <td className="text-right py-2">{row.commits}</td>
                      <td className="text-right py-2">{row.prs}</td>
                      <td className="text-right py-2">{row.reviews}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
