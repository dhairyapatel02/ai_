'use client';

import {
  LayoutDashboard,
  Link2,
  FileText,
  ClipboardList,
  TrendingUp,
  Trophy,
  Clock,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/connect', label: 'Integrations', icon: Link2 },
  { href: '/resume', label: 'Resume', icon: FileText },
  { href: '/appraisal', label: 'Appraisal', icon: ClipboardList },
  { href: '/promotion', label: 'Promotion', icon: TrendingUp },
  { href: '/career', label: 'Career Timeline', icon: Clock },
  { href: '/kpis', label: 'KPIs', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden border-r bg-card lg:flex lg:w-64 lg:flex-col">
      <div className="flex items-center gap-2 border-b px-6 py-5">
        <Trophy className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">DevImpact AI</span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t px-4 py-3">
        {user ? (
          <>
            <p className="truncate text-xs text-muted-foreground" title={user.email}>
              {user.email}
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </>
        ) : null}
        <p className="text-xs text-muted-foreground">DevImpact AI v0.1.0</p>
      </div>
    </aside>
  );
}
