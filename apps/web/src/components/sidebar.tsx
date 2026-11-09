'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
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
} from 'lucide-react';

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

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r bg-card">
      <div className="flex items-center gap-2 px-6 py-5 border-b">
        <Trophy className="h-6 w-6 text-primary" />
        <span className="font-bold text-lg">DevImpact AI</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
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
      <div className="border-t px-4 py-3">
        <p className="text-xs text-muted-foreground">DevImpact AI v0.1.0</p>
      </div>
    </aside>
  );
}
