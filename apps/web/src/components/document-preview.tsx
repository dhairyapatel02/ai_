'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DocumentPreviewProps {
  content: Record<string, unknown>;
  type: string;
}

export function DocumentPreview({ content, type }: DocumentPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg capitalize">{type.toLowerCase()} Document</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-sm whitespace-pre-wrap bg-muted p-4 rounded-md overflow-auto max-h-96">
          {JSON.stringify(content, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
