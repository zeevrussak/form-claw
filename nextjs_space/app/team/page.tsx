export const dynamic = 'force-dynamic';

import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { TeamClient } from './_components/team-client';

export default function TeamPage() {
  return (
    <DashboardLayout>
      <TeamClient />
    </DashboardLayout>
  );
}
