import { Wordmark } from '@/components/brand';
import { getServerEnv, isDevLoginEnabled } from '@/env';

import { safeCallback } from './safe-callback';
import { SignInButtons } from './sign-in-buttons';
import { signInNotice } from './sign-in-notice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** SCREENS S1 · Sign-in: GitHub, Google, dev-only demo button (ENABLE_DEV_LOGIN outside prod). */
export default async function SignInPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const env = getServerEnv();
  const callbackUrl = safeCallback(first(searchParams.callbackUrl));
  const notice = signInNotice({
    error: first(searchParams.error),
    provider: first(searchParams.provider),
    reason: first(searchParams.reason),
  });

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-lg border bg-card p-6 sm:p-8">
        <Wordmark />
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to DevImpact</h1>
          <p className="text-muted-foreground">
            Your engineering work, measured fairly and written up for you — every claim backed by a
            PR.
          </p>
        </div>
        <SignInButtons
          callbackUrl={callbackUrl}
          github={Boolean(env.github)}
          google={Boolean(env.google)}
          devLogin={isDevLoginEnabled()}
          notice={notice}
        />
      </div>
    </main>
  );
}
