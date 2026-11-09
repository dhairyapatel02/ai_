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
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
          {JSON.stringify(content, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
