import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { KnowledgeClient } from './_components/knowledge-client';

export const dynamic = 'force-dynamic';

export default function KnowledgePage() {
  return (
    <DashboardLayout>
      <KnowledgeClient />
    </DashboardLayout>
  );
}
