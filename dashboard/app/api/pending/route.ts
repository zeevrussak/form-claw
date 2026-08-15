export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const snap = await db.collection('pending_forms')
    .orderBy('created_at', 'desc')
    .limit(50)
    .get();

  const forms = snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      senderEmail: d.sender_email,
      subject: d.subject,
      status: d.status,
      targetPerson: d.target_person,
      missingFields: d.missing_fields || [],
      createdAt: toDate(d.created_at)?.toISOString() || null,
      resumedAt: toDate(d.resumed_at)?.toISOString() || null,
    };
  });

  return NextResponse.json({ forms, total: forms.length });
}
