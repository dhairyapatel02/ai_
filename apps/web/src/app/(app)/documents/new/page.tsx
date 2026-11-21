import { ArrowRight, FileText, ListChecks, TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/states';

export const metadata = { title: 'New document' };

const TYPES = [
  {
    href: '/documents/new/appraisal',
    icon: FileText,
    title: 'Appraisal',
    text: 'A self-review for a month, quarter, half-year, year or custom range. Metrics tables are filled by DevImpact, not the AI.',
  },
  {
    href: '/documents/new/promotion',
    icon: TrendingUp,
    title: 'Promotion packet',
    text: 'Your case for the next level, structured around scope, impact and leadership, with evidence links.',
  },
  {
    href: '/documents/new/resume',
    icon: ListChecks,
    title: 'Resume bullets',
    text: '5–8 quantified bullets tailored to a role, optionally to a job description.',
  },
];

/** S12 · New document: three cards, one sentence each, "Start …" (static, no data). */
export default function NewDocumentPage() {
  return (
    <>
      <PageHeader
        title="New document"
        lede="Pick what you need. You can edit, regenerate and export every document."
      />
      <ul className="grid gap-3 md:grid-cols-3">
        {TYPES.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="flex h-full flex-col gap-3 rounded-md border bg-card p-4 transition-colors hover:bg-surface-2"
            >
              <span className="flex size-8 items-center justify-center rounded-sm bg-accent text-accent-foreground">
                <t.icon className="size-4" aria-hidden="true" />
              </span>
              <span className="text-md font-semibold">{t.title}</span>
              <span className="flex-1 text-base text-muted-foreground">{t.text}</span>
              <span className="flex items-center gap-1 text-base font-medium text-link">
                Start {t.title.toLowerCase()}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
