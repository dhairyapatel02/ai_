import { Construction, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';

/**
 * Placeholder for IA destinations whose designed screen lands in a later phase (P10–P12), so the
 * shell's navigation is complete and no link leads to a 404 in the meantime.
 */
export function ComingSoon({
  title,
  lede,
  icon = Construction,
  description,
}: {
  title: string;
  lede?: string;
  icon?: LucideIcon;
  description: string;
}) {
  return (
    <>
      <PageHeader title={title} lede={lede} />
      <div className="rounded-md border bg-card">
        <EmptyState
          icon={icon}
          title="Not available yet"
          description={description}
          actions={
            <Button variant="secondary" asChild>
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          }
        />
      </div>
    </>
  );
}
