import { UnsubscribeView } from './unsubscribe-view';

export const metadata = { title: 'Unsubscribe', robots: { index: false } };

// SCREENS S24 — public unsubscribe (no shell, no sign-in).
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  return <UnsubscribeView token={typeof token === 'string' ? token : null} />;
}
