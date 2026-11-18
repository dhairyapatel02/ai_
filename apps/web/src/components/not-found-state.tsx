'use client';

import { Compass, Search } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/states';
import { useOptionalShell } from '@/components/shell/shell-context';
import { Button } from '@/components/ui/button';

/** SCREENS S25 404: "Page not found" + Go to dashboard + Search (opens ⌘K when in the shell). */
export function NotFoundState() {
  const shell = useOptionalShell();
  const onSearch = shell
    ? () => {
        shell.setPaletteOpen(true);
      }
    : undefined;
  return (
    <EmptyState
      icon={Compass}
      headingLevel={1}
      className="pt-20"
      title="Page not found"
      description="The page may have moved, or the link is incomplete."
      actions={
        <>
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
          {onSearch ? (
            <Button variant="secondary" onClick={onSearch}>
              <Search aria-hidden="true" />
              Search
            </Button>
          ) : null}
        </>
      }
    />
  );
}
