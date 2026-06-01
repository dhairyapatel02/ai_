'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const timelineData = [
  {
    year: '2024',
    quarter: 'Q2',
    items: [
      { title: 'Real-time Notification System', repo: 'myapp/backend', tags: ['feature', 'architecture'] },
      { title: 'GraphQL Migration', repo: 'myapp/api', tags: ['refactor', 'performance'] },
      { title: 'CI/CD Pipeline Overhaul', repo: 'myapp/infra', tags: ['devops', 'reliability'] },
    ],
  },
  {
    year: '2024',
    quarter: 'Q1',
    items: [
      { title: 'User Analytics Dashboard', repo: 'myapp/frontend', tags: ['feature', 'frontend'] },
      { title: 'Database Optimization', repo: 'myapp/backend', tags: ['performance', 'database'] },
      { title: 'OAuth2 Implementation', repo: 'myapp/auth', tags: ['security', 'feature'] },
    ],
  },
  {
    year: '2023',
    quarter: 'Q4',
    items: [
      { title: 'Microservices Architecture', repo: 'myapp/services', tags: ['architecture', 'infra'] },
      { title: 'Automated Testing Framework', repo: 'myapp/testing', tags: ['quality', 'devops'] },
    ],
  },
];

export default function CareerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Career Timeline</h1>
        <p className="text-muted-foreground">Your engineering journey visualized</p>
      </div>

      <div className="space-y-8">
        {timelineData.map((period, idx) => (
          <div key={idx} className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                {period.quarter}
              </div>
              <h2 className="text-xl font-semibold">{period.year} {period.quarter}</h2>
            </div>
            <div className="ml-5 border-l-2 border-border pl-6 space-y-3">
              {period.items.map((item, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-medium">{item.title}</h3>
                        <p className="text-sm text-muted-foreground">{item.repo}</p>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
