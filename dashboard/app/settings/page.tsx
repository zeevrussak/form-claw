import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { SettingsClient } from './_components/settings-client';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <SettingsClient />
    </DashboardLayout>
  );
}
