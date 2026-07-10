export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firestore';

/**
 * POST /api/health/heartbeat
 * Called by daemon scripts to report their status.
 * Body: { daemon: 'form_process', status: 'ok' | 'error', message?: string }
 * Auth: Bearer token from env HEARTBEAT_TOKEN (shared secret)
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedToken = process.env.HEARTBEAT_TOKEN;

    if (!expectedToken || !authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { daemon, status, message } = body;

    if (!daemon || !['form_process'].includes(daemon)) {
      return NextResponse.json({ error: 'Invalid daemon name' }, { status: 400 });
    }

    const now = new Date();
    const statusRef = db.collection(COLLECTIONS.SYSTEM).doc('current');
    const statusDoc = await statusRef.get();

    const updateData: Record<string, any> = {
      updated_at: now,
    };

    if (daemon === 'form_process') {
      updateData.processor_status = status === 'ok' ? 'healthy' : 'error';
      updateData.processor_last_heartbeat = now;
      if (message) updateData.processor_message = message;
      if (status === 'error') {
        updateData.processor_error = message || 'Unknown error';
        updateData.processor_error_at = now;
      }
    }

    if (statusDoc.exists) {
      await statusRef.update(updateData);
    } else {
      await statusRef.set({
        ...updateData,
        created_at: now,
        webhook_enabled: true,
        processor_status: 'healthy',
      });
    }

    return NextResponse.json({ ok: true, updated: now.toISOString() });
  } catch (error: any) {
    console.error('Heartbeat error:', error);
    return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 });
  }
}
