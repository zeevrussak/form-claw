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
  const status = searchParams.get('status');
  const sender = searchParams.get('sender');
  const search = searchParams.get('search');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.LOGS)
    .orderBy('received_at', 'desc');

  if (status) {
    query = query.where('processing_status', '==', status);
  }
  if (sender) {
    query = query.where('sender_email', '==', sender);
  }
  if (startDate) {
    query = query.where('received_at', '>=', new Date(startDate));
  }
  if (endDate) {
    query = query.where('received_at', '<=', new Date(endDate));
  }

  // Get total count (Firestore doesn't have native count in free tier easily)
  // We'll use a separate count query
  const countSnap = await query.count().get();
  const total = countSnap.data().count;

  // Paginate
  const offset = (page - 1) * limit;
  const snapshot = await query.offset(offset).limit(limit).get();

  const logs = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      emailMessageId: d.email_message_id,
      receivedAt: toDate(d.received_at)?.toISOString() || null,
      senderEmail: d.sender_email,
      senderName: d.sender_name,
      subject: d.subject,
      attachmentFilename: d.attachment_filename,
      attachmentType: d.attachment_type,
      attachmentCount: d.attachment_count || 0,
      pageCount: d.page_count,
      targetPerson: d.target_person,
      signer: d.signer,
      processingStatus: d.processing_status,
      processingStartedAt: toDate(d.processing_started_at)?.toISOString() || null,
      processingCompletedAt: toDate(d.processing_completed_at)?.toISOString() || null,
      processingTimeSeconds: d.processing_time_seconds || 0,
      filledPdfFilename: d.filled_pdf_filename || d.filled_pdf_path,
      errorMessage: d.error_message,
      errorType: d.error_type,
      instructionsDetected: d.instructions_detected,
      createdAt: toDate(d.created_at)?.toISOString() || toDate(d.received_at)?.toISOString(),
    };
  });

  // Client-side search filter (Firestore doesn't support LIKE)
  let filtered = logs;
  if (search) {
    const s = search.toLowerCase();
    filtered = logs.filter(l =>
      (l.subject || '').toLowerCase().includes(s) ||
      (l.senderEmail || '').toLowerCase().includes(s)
    );
  }

  return NextResponse.json({
    logs: filtered,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
