'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const COLLAPSE_KEY = 'devimpact:sidebar-collapsed';
const SINGLE_KEY = 'devimpact:single-key-shortcuts';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable (private mode): the preference just isn't remembered.
  }
}

interface ShellState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  periodOpen: boolean;
  setPeriodOpen: (open: boolean) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
  singleKeyShortcuts: boolean;
  setSingleKeyShortcuts: (on: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

/** UI state shared by the shell's overlays (palette, period picker, drawer, shortcut list). */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [singleKeyShortcuts, setSingleKey] = useState(true);

  // Per-device conveniences live in localStorage (IA §6); read after mount (no hydration mismatch).
  useEffect(() => {
    setCollapsed(readFlag(COLLAPSE_KEY, false));
    setSingleKey(readFlag(SINGLE_KEY, true));
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      writeFlag(COLLAPSE_KEY, !value);
      return !value;
    });
  }, []);
  const setSingleKeyShortcuts = useCallback((on: boolean) => {
    writeFlag(SINGLE_KEY, on);
    setSingleKey(on);
  }, []);

  const value = useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      periodOpen,
      setPeriodOpen,
      navOpen,
      setNavOpen,
      shortcutsOpen,
      setShortcutsOpen,
      collapsed,
      toggleCollapsed,
      singleKeyShortcuts,
      setSingleKeyShortcuts,
    }),
    [
      paletteOpen,
      periodOpen,
      navOpen,
      shortcutsOpen,
      collapsed,
      toggleCollapsed,
      singleKeyShortcuts,
      setSingleKeyShortcuts,
    ],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>');
  return ctx;
}

/** Shell state when rendered inside the shell, otherwise null (e.g. standalone 404). */
export function useOptionalShell(): ShellState | null {
  return useContext(ShellContext);
}
