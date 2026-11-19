import { CareerTimelineResponse, MeDto } from '@devimpact/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CareerMilestone } from '@/components/career-milestone';
import { isApiError } from '@/lib/api/errors';
import { getServerApi } from '@/lib/api/server';
import {
  displayRef,
  hiddenOnServer,
  isEmptyQuarter,
  quarterRange,
  quarterTotals,
  reviewClusterLabel,
} from '@/lib/career';
import { formatLocalDate } from '@/lib/format';

import { parseYear } from '../../../(app)/career/year';
import { PrintButton } from './print-button';

export const metadata = { title: 'Career · Print view' };

/**
 * Career print view (S10): rendered on the server (no client data fetching), every item
 * expanded, one quarter per printed page, evidence refs in mono.
 */
export default async function CareerPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const year = parseYear(yearParam ?? null);
  let timeline: CareerTimelineResponse;
  let name = '';
  try {
    const api = await getServerApi();
    const [t, me] = await Promise.all([
      api.get('/career/timeline', { schema: CareerTimelineResponse, query: { year } }),
      api.get('/me', { schema: MeDto }),
    ]);
    timeline = t;
    name = me.user.name;
  } catch (error) {
    if (isApiError(error) && error.code === 'UNAUTHENTICATED') redirect('/sign-in');
    return (
      <main id="main" className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold">Couldn&apos;t load your career timeline</h1>
        <p className="mt-2">
          The DevImpact API didn&apos;t respond. Your data is safe — try again in a moment.
        </p>
        <Link href="/career" className="mt-4 inline-block underline">
          Back to Career
        </Link>
      </main>
    );
  }
  const quarters = timeline.quarters;
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex flex-wrap items-start gap-3 print:hidden">
        <Link
          href={`/career?year=${timeline.year}`}
          className="mr-auto self-center text-sm underline"
        >
          Back to Career
        </Link>
        <PrintButton />
      </div>
      <header className="mb-6 border-b pb-4">
        <h1 className="text-2xl font-semibold">Career timeline · {timeline.year}</h1>
        <p className="text-sm text-muted-foreground">
          {name ? `${name} · ` : ''}Merged pull requests, reviews, milestones and achievements from
          GitHub, by quarter. Times in {timeline.timezone}.
        </p>
      </header>
      {quarters.every(isEmptyQuarter) ? (
        <p>No merged work, reviews or achievements in {timeline.year}.</p>
      ) : (
        quarters.map((q) => (
          <section
            key={q.quarter}
            className="print-quarter mb-8"
            aria-label={`Q${q.quarter} ${timeline.year}`}
          >
            <h2 className="text-lg font-semibold">
              Q{q.quarter} {timeline.year}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                · {quarterRange(q)}
                {isEmptyQuarter(q) ? '' : ` · ${quarterTotals(q.totals)}`}
              </span>
            </h2>
            {isEmptyQuarter(q) ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No merged work or reviews this quarter.
              </p>
            ) : (
              <>
                {q.milestones.length ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {q.milestones.map((m, i) => (
                      <CareerMilestone key={`${m.kind}-${i}`} milestone={m} />
                    ))}
                  </div>
                ) : null}
                {q.repos.map((repo) => (
                  <div key={repo.repositoryId} className="mt-4 break-inside-avoid">
                    <h3 className="font-medium">{repo.fullName}</h3>
                    <ul className="mt-1 flex flex-col gap-1 text-sm">
                      {repo.items.map((item) => (
                        <li key={item.id} className="flex flex-wrap gap-x-2">
                          {item.type === 'review_cluster' ? (
                            <span>{reviewClusterLabel(item.count ?? 1)}</span>
                          ) : (
                            <>
                              <span>{item.title}</span>
                              <span className="font-mono text-caption text-muted-foreground">
                                {displayRef(item.ref)}
                              </span>
                              <span className="text-caption text-muted-foreground">
                                {formatLocalDate(item.date, { withYear: false })}
                                {item.tags.length ? ` · ${item.tags.slice(0, 3).join(', ')}` : ''}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                      {hiddenOnServer(repo) > 0 ? (
                        <li className="text-caption text-muted-foreground">
                          and {hiddenOnServer(repo)} more
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </section>
        ))
      )}
    </main>
  );
}
