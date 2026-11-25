import { IntegrationsView } from './integrations-view';

export const metadata = { title: 'Integrations' };

export default async function IntegrationsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { connectError, provider } = await props.searchParams;
  return (
    <IntegrationsView
      connectError={typeof connectError === 'string' ? connectError : undefined}
      provider={typeof provider === 'string' ? provider : undefined}
    />
  );
}
