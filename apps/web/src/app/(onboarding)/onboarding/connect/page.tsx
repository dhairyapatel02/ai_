import { ConnectStep } from './connect-step';

export const metadata = { title: 'Connect GitHub' };

export default async function ConnectPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await props.searchParams;
  return <ConnectStep error={typeof error === 'string' ? error : undefined} />;
}
