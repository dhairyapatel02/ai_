'use client';

import {
  ConnectReturnTo,
  PROVIDER_LABELS,
  ProviderCallbackResult,
  type OAuthProviderWire,
} from '@devimpact/shared';
import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { apiClient } from '@/lib/api/browser';
import { CONNECT_RETURN_KEY } from '@/lib/onboarding';

import { callbackErrorKey } from '../../github/callback/github-callback';

/** OAuth `code` / `state` (+ `error`) from the provider's redirect → API callback body. */
export function providerCallbackBody(params: Record<string, string>) {
  return Object.fromEntries(
    Object.entries({
      code: params.code,
      state: params.state,
      error: params.error,
      errorDescription: params.error_description,
    }).filter(([, v]) => v !== undefined && v !== ''),
  );
}

function rememberedReturn(): ConnectReturnTo {
  try {
    const parsed = ConnectReturnTo.safeParse(window.sessionStorage.getItem(CONNECT_RETURN_KEY));
    return parsed.success ? parsed.data : '/settings/integrations';
  } catch {
    return '/settings/integrations';
  }
}

/**
 * Forwards the provider's redirect to `POST /integrations/:provider/callback` (state verified and
 * code exchanged server-side) exactly once, removes code/state from the address bar, then returns
 * to Settings → Integrations (or onboarding) with a toast or a `connectError`.
 */
export function ProviderCallback({
  provider,
  params,
}: {
  provider: OAuthProviderWire;
  params: Record<string, string>;
}) {
  const router = useRouter();
  const started = useRef(false);
  const label = PROVIDER_LABELS[provider];

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, '', `/integrations/${provider}/callback`);
    const fallback = rememberedReturn();
    const errorTarget = (key: string) =>
      fallback === '/onboarding'
        ? `/onboarding/connect?error=${key}`
        : `/settings/integrations?connectError=${key}&provider=${provider}`;
    if (!params.state) {
      router.replace(errorTarget('expired'));
      return;
    }
    void (async () => {
      try {
        const result = await apiClient.post(`/integrations/${provider}/callback`, {
          body: providerCallbackBody(params),
          schema: ProviderCallbackResult,
        });
        try {
          window.sessionStorage.removeItem(CONNECT_RETURN_KEY);
        } catch {
          // ignore
        }
        const parsed = ConnectReturnTo.safeParse(result.returnTo);
        toast.success(`${label} connected. Importing your activity…`);
        router.replace(parsed.success ? parsed.data : fallback);
      } catch (error) {
        router.replace(errorTarget(callbackErrorKey(error)));
      }
    })();
  }, [label, params, provider, router]);

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Connecting your {label} account…</h1>
      <p className="text-muted-foreground" role="status">
        This takes a few seconds.
      </p>
    </div>
  );
}
