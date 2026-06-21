import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { ErrorsClient } from './_components/errors-client';

export const dynamic = 'force-dynamic';

export default function ErrorsPage() {
  return (
    <DashboardLayout>
      <ErrorsClient />
    </DashboardLayout>
  );
}
