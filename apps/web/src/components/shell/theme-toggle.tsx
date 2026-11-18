'use client';

import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const ORDER = ['system', 'light', 'dark'] as const;
type ThemeChoice = (typeof ORDER)[number];

export function nextTheme(current: string | undefined): ThemeChoice {
  const index = ORDER.indexOf((current ?? 'system') as ThemeChoice);
  return ORDER[(index + 1) % ORDER.length] ?? 'system';
}

/** Cycles System → Light → Dark (DESIGN_SYSTEM §11); persisted by next-themes in localStorage. */
export function ThemeToggle({ size = 'icon-sm' }: { size?: 'icon-sm' | 'icon' }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const current = (mounted ? theme : 'system') ?? 'system';
  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : SunMoon;
  const label = `Theme: ${current}. Change theme`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={label}
          data-testid="theme-toggle"
          data-theme-choice={current}
          onClick={() => {
            setTheme(nextTheme(current));
          }}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Theme: {current}</TooltipContent>
    </Tooltip>
  );
}
