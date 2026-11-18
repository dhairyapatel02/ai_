import { FileText, ListChecks, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/states';

export const metadata = { title: 'New document' };

const TYPES = [
  {
    href: '/documents/new/appraisal',
    icon: FileText,
    title: 'Appraisal',
    text: 'A self-review for a period, with key contributions and engine-made metrics.',
  },
  {
    href: '/documents/new/promotion',
    icon: TrendingUp,
    title: 'Promotion packet',
    text: 'The case for your next level, backed by pull requests and reviews.',
  },
  {
    href: '/documents/new/resume',
    icon: ListChecks,
    title: 'Resume bullets',
    text: 'Concise, cited bullets for your resume or LinkedIn.',
  },
];

// SCREENS S12 (interim): type picker; P11 builds the designed studio flow.
export default function NewDocumentPage() {
  return (
    <>
      <PageHeader title="New document" lede="Choose what you want DevImpact to draft." />
      <ul className="grid gap-3 md:grid-cols-3">
        {TYPES.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="flex h-full flex-col gap-2 rounded-md border bg-card p-4 hover:bg-surface-2"
            >
              <t.icon className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="font-semibold">{t.title}</span>
              <span className="text-muted-foreground">{t.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
