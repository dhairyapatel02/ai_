import { Bell } from 'lucide-react';

import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Notifications' };

// SCREENS S21 — arrives in P12.
export default function NotificationsPage() {
  return (
    <ComingSoon
      title="Notifications"
      icon={Bell}
      description="Weekly digest and sync emails are being built."
    />
  );
}
