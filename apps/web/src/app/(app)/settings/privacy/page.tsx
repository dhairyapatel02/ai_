import { Shield } from 'lucide-react';

import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Privacy & data' };

// SCREENS S22 — arrives in P12 (export, delete account, AI redaction).
export default function PrivacyPage() {
  return (
    <ComingSoon
      title="Privacy & data"
      icon={Shield}
      description="Data export, AI redaction and account deletion settings are being built."
    />
  );
}
