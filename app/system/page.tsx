import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { SystemClient } from './_components/system-client';

export const dynamic = 'force-dynamic';

export default function SystemPage() {
  return (
    <DashboardLayout>
      <SystemClient />
    </DashboardLayout>
  );
}
