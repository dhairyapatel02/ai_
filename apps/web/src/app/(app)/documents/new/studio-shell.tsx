'use client';


import { DocumentPreview } from '@/components/document-preview';
import { Banner, PageHeader } from '@/components/states';
import { Card, CardContent } from '@/components/ui/card';
import { useGenerateDocument } from '@/lib/documents';

import type { ReactNode } from 'react';

/** Shared frame of the interim studios (P11 builds S13–S15 with streaming). */
export function StudioShell({
  title,
  lede,
  type,
  children,
}: {
  title: string;
  lede: string;
  type: 'resume' | 'appraisal' | 'promotion';
  children: (generator: ReturnType<typeof useGenerateDocument>) => ReactNode;
}) {
  const generator = useGenerateDocument();
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <PageHeader title={title} lede={lede} className="mb-2" />
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">{children(generator)}</CardContent>
      </Card>
      {generator.error ? (
        <Banner tone="danger" role="alert" title="The draft couldn't be generated">
          {generator.error}
        </Banner>
      ) : null}
      {generator.detail?.version ? (
        <DocumentPreview
          type={type}
          content={generator.detail.version.content as Record<string, unknown>}
        />
      ) : null}
    </div>
  );
}
