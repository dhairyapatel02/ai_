import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { publicEnv } from '@/env';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const API_BASE = publicEnv.NEXT_PUBLIC_API_URL;
