import { GitHubCallback } from './github-callback';

export const metadata = { title: 'Connecting GitHub' };

/** GitHub App setup/authorize callback (IA `/integrations/github/callback`). */
export default async function GitHubCallbackPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await props.searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
  return <GitHubCallback params={params} />;
}
