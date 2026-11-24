import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { publicEnv } from '@/env';

/**
 * tailwind-merge that knows the token font sizes (`--text-caption`, `--text-md`): without this it
 * treats `text-caption` as a colour and drops it next to `text-muted-foreground` (badges lost
 * their 12 px size, found in P11).
 */
const twMerge = extendTailwindMerge({ extend: { theme: { text: ['caption', 'md'] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const API_BASE = publicEnv.NEXT_PUBLIC_API_URL;
