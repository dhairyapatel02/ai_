import {
  Award,
  Bell,
  CircleGauge,
  FileText,
  Gauge,
  LayoutDashboard,
  List,
  Milestone,
  Plug,
  Shield,
  Target,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** `G` + key shortcut (IA §5). */
  shortcut?: string;
}

export interface NavGroup {
  label: 'Overview' | 'Create' | 'Settings';
  items: NavItem[];
}

/** Grouped navigation mirroring the core loop (IA §1, §3.1). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'D' },
      { href: '/activity', label: 'Activity', icon: List, shortcut: 'A' },
      { href: '/kpis', label: 'KPIs', icon: Gauge, shortcut: 'K' },
      { href: '/career', label: 'Career', icon: Milestone, shortcut: 'C' },
    ],
  },
  {
    label: 'Create',
    items: [
      { href: '/documents', label: 'Documents', icon: FileText, shortcut: 'O' },
      { href: '/achievements', label: 'Achievements', icon: Award },
      { href: '/goals', label: 'Goals', icon: Target },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/integrations', label: 'Integrations', icon: Plug },
      { href: '/settings/profile', label: 'Profile', icon: User },
      { href: '/settings/notifications', label: 'Notifications', icon: Bell },
      { href: '/settings/privacy', label: 'Privacy & data', icon: Shield },
      { href: '/settings/plan', label: 'Plan & usage', icon: CircleGauge },
    ],
  },
];

/** Mobile bottom bar: the four most frequent destinations + More (IA §3.4). */
export const BOTTOM_BAR: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/activity', label: 'Activity', icon: List },
  { href: '/kpis', label: 'KPIs', icon: Gauge },
  { href: '/documents', label: 'Docs', icon: FileText },
];

export interface RouteMeta {
  title: string;
  parent?: { label: string; href?: string };
  /** The page's data depends on the global period → the top bar shows the period picker. */
  period?: boolean;
}

const ROUTES: [prefix: string, meta: RouteMeta][] = [
  ['/dashboard', { title: 'Dashboard', period: true }],
  ['/activity', { title: 'Activity', period: true }],
  [
    '/kpis/impact',
    { title: 'Impact score', parent: { label: 'KPIs', href: '/kpis' }, period: true },
  ],
  ['/kpis', { title: 'KPIs', period: true }],
  ['/career', { title: 'Career' }],
  [
    '/documents/new/appraisal',
    { title: 'New appraisal', parent: { label: 'Documents', href: '/documents' } },
  ],
  [
    '/documents/new/promotion',
    { title: 'New promotion packet', parent: { label: 'Documents', href: '/documents' } },
  ],
  [
    '/documents/new/resume',
    { title: 'New resume', parent: { label: 'Documents', href: '/documents' } },
  ],
  ['/documents/new', { title: 'New document', parent: { label: 'Documents', href: '/documents' } }],
  ['/documents/', { title: 'Document', parent: { label: 'Documents', href: '/documents' } }],
  ['/documents', { title: 'Documents' }],
  ['/achievements', { title: 'Achievements' }],
  ['/goals', { title: 'Goals' }],
  ['/settings/integrations', { title: 'Integrations', parent: { label: 'Settings' } }],
  ['/settings/profile', { title: 'Profile', parent: { label: 'Settings' } }],
  ['/settings/notifications', { title: 'Notifications', parent: { label: 'Settings' } }],
  ['/settings/privacy', { title: 'Privacy & data', parent: { label: 'Settings' } }],
  ['/settings/plan', { title: 'Plan & usage', parent: { label: 'Settings' } }],
];

export function routeMeta(pathname: string): RouteMeta {
  for (const [prefix, meta] of ROUTES) {
    if (
      prefix.endsWith('/')
        ? pathname.startsWith(prefix)
        : pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
      return meta;
  }
  return { title: 'Page not found' };
}

/** Child routes keep their parent item active (`/kpis/impact` → KPIs, IA §3.1). */
export function isNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Routes that carry `?period` along when navigating between Overview pages (IA §4). */
export const PERIOD_PATHS = new Set(['/dashboard', '/activity', '/kpis', '/kpis/impact']);

/** Builds an href that keeps the current `?period=` when moving between period pages. */
export function hrefWithPeriod(href: string, period: string | null): string {
  if (!period || !PERIOD_PATHS.has(href)) return href;
  return `${href}?period=${encodeURIComponent(period)}`;
}
