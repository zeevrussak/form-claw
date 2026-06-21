import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { StatisticsClient } from './_components/statistics-client';

export const dynamic = 'force-dynamic';

export default function StatisticsPage() {
  return (
    <DashboardLayout>
      <StatisticsClient />
    </DashboardLayout>
  );
}
