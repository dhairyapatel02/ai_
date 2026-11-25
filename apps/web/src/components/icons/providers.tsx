import { GitHubIcon } from './github';

import type { ProviderWire } from '@devimpact/shared';
import type { SVGProps } from 'react';

/**
 * Simplified monochrome marks (lucide 1.x has no brand icons). Decorative: the adjacent text
 * always names the provider.
 */
export function GitLabIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="m23.6 9.6-.03-.09-3.27-8.53a.86.86 0 0 0-1.63.06l-2.2 6.75H7.53L5.33 1.04A.86.86 0 0 0 3.7.98L.43 9.5l-.03.09a6.07 6.07 0 0 0 2.01 7.01l.01.01.03.02 4.99 3.74 2.47 1.87 1.5 1.14a1 1 0 0 0 1.22 0l1.5-1.14 2.47-1.87 5.02-3.76.01-.01a6.07 6.07 0 0 0 2-7Z" />
    </svg>
  );
}

export function JiraIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M11.57 0H.68a4.9 4.9 0 0 0 4.9 4.9h2v1.94A4.9 4.9 0 0 0 12.48 11.7V.91a.9.9 0 0 0-.91-.91Zm5.4 5.36H6.07a4.9 4.9 0 0 0 4.9 4.9h2v1.95a4.9 4.9 0 0 0 4.9 4.9V6.27a.9.9 0 0 0-.9-.91Zm5.4 5.37H11.46a4.9 4.9 0 0 0 4.9 4.9h2.01v1.94A4.9 4.9 0 0 0 23.27 22.48V11.64a.9.9 0 0 0-.9-.91Z" />
    </svg>
  );
}

export function LinearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M.4 14.16 9.84 23.6A12 12 0 0 1 .4 14.16Zm-.4-3.2L13.04 24a11.9 11.9 0 0 0 3.14-.86L.86 7.82A11.9 11.9 0 0 0 0 10.96Zm1.93-4.8L17.84 22.07a12.1 12.1 0 0 0 2.5-1.86L3.79 3.66a12.1 12.1 0 0 0-1.86 2.5ZM5.16 2.5A12 12 0 0 1 24 12c0 3.03-1.12 5.8-2.97 7.9L4.1 2.97c.33-.17.7-.33 1.06-.47Z" />
    </svg>
  );
}

const ICONS = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  jira: JiraIcon,
  linear: LinearIcon,
} as const;

export function ProviderIcon({
  provider,
  ...props
}: SVGProps<SVGSVGElement> & { provider: ProviderWire }) {
  const Icon = ICONS[provider];
  return <Icon {...props} />;
}
