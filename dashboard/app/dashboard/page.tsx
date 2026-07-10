import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { DashboardClient } from './_components/dashboard-client';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <DashboardClient />
    </DashboardLayout>
  );
}
