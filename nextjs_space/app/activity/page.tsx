import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { ActivityClient } from './_components/activity-client';

export const dynamic = 'force-dynamic';

export default function ActivityPage() {
  return (
    <DashboardLayout>
      <ActivityClient />
    </DashboardLayout>
  );
}
