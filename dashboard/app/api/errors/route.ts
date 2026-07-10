export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const errorType = searchParams.get('errorType');

  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.LOGS)
    .where('processing_status', '==', 'failed')
    .orderBy('received_at', 'desc');

  const snapshot = await query.get();
  let allErrors = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      receivedAt: toDate(d.received_at)?.toISOString() || null,
      senderEmail: d.sender_email,
      senderName: d.sender_name,
      subject: d.subject,
      errorMessage: d.error_message,
      errorType: d.error_type || 'Unknown',
      targetPerson: d.target_person,
      processingTimeSeconds: d.processing_time_seconds || 0,
    };
  });

  // Filter by error type client-side
  if (errorType) {
    allErrors = allErrors.filter(e => e.errorType === errorType);
  }

  // Error type breakdown
  const typeMap: Record<string, number> = {};
  allErrors.forEach(e => {
    typeMap[e.errorType] = (typeMap[e.errorType] || 0) + 1;
  });
  const errorTypes = Object.entries(typeMap)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const total = allErrors.length;
  const offset = (page - 1) * limit;
  const paginated = allErrors.slice(offset, offset + limit);

  return NextResponse.json({
    errors: paginated,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    errorTypes,
  });
}
