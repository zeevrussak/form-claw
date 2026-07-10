export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const statusDoc = await db.collection(COLLECTIONS.SYSTEM).doc('current').get();
  const status = statusDoc.exists ? statusDoc.data()! : {};

  // Get last successful form
  const lastSuccess = await db.collection(COLLECTIONS.LOGS)
    .where('processing_status', '==', 'success')
    .orderBy('received_at', 'desc')
    .limit(1)
    .get();

  const lastForm = lastSuccess.empty ? null : toDate(lastSuccess.docs[0].data().received_at)?.toISOString();

  return NextResponse.json({
    webhookEnabled: status.webhook_enabled ?? true,
    emailSource: status.email_source ?? 'cloudflare',
    lastCloudflareEmail: toDate(status.last_cloudflare_email)?.toISOString() || null,
    lastSuccessfulForm: lastForm,
    daemonHealth: {
      formProcessor: {
        lastRun: toDate(status.last_form_process_run)?.toISOString() || null,
        status: status.form_process_status || 'unknown',
      },
    },
    dbConnected: true,
  });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const db = getDb();
  const ref = db.collection(COLLECTIONS.SYSTEM).doc('current');

  const updates: Record<string, any> = { updated_at: new Date() };
  if ('webhookEnabled' in body) updates.webhook_enabled = body.webhookEnabled;

  await ref.set(updates, { merge: true });

  return NextResponse.json({ success: true });
}
