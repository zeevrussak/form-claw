export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const snapshot = await db.collection(COLLECTIONS.LOGS)
    .where('processing_status', '==', 'failed')
    .orderBy('received_at', 'desc')
    .get();

  const csvRows = ['Timestamp,Sender Email,Subject,Error Type,Error Message,Target Person'];
  snapshot.docs.forEach(doc => {
    const d = doc.data();
    const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    csvRows.push([
      toDate(d.received_at)?.toISOString() || '',
      escape(d.sender_email || ''),
      escape(d.subject || ''),
      escape(d.error_type || 'Unknown'),
      escape(d.error_message || ''),
      escape(d.target_person || ''),
    ].join(','));
  });

  return new NextResponse(csvRows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=error_logs.csv',
    },
  });
}
