import { OAuthProviderWire } from '@devimpact/shared';
import { notFound } from 'next/navigation';

import { ProviderCallback } from './provider-callback';

export const metadata = { title: 'Connecting' };

/** GitLab / Jira / Linear OAuth callback (`/integrations/:provider/callback`, P13). */
export default async function ProviderCallbackPage(props: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ provider }, raw] = await Promise.all([props.params, props.searchParams]);
  const parsed = OAuthProviderWire.safeParse(provider);
  if (!parsed.success) notFound();
  const params = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  );
  return <ProviderCallback provider={parsed.data} params={params} />;
}
