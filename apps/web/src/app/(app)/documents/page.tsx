import { FileText } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Documents' };

// SCREENS S11 — the documents library arrives in P11; until then this links to the studios.
export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents"
        lede="Appraisals, promotion packets and resume bullets written from your evidence."
        actions={
          <Button asChild>
            <Link href="/documents/new">New document</Link>
          </Button>
        }
      />
      <div className="rounded-md border bg-card">
        <EmptyState
          icon={FileText}
          title="Your library is coming soon"
          description="Start a new document below. Saved documents will be listed here."
          actions={
            <Button variant="secondary" asChild>
              <Link href="/documents/new">Choose a document type</Link>
            </Button>
          }
        />
      </div>
    </>
  );
}
