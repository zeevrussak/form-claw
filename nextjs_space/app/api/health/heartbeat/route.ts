export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/health/heartbeat
 * Called by daemon scripts to report their status.
 * Body: { daemon: 'watch_renew' | 'form_process', status: 'ok' | 'error', message?: string }
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

    if (!daemon || !['watch_renew', 'form_process'].includes(daemon)) {
      return NextResponse.json({ error: 'Invalid daemon name' }, { status: 400 });
    }

    const now = new Date();
    let systemStatus = await prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } });

    const updateData: Record<string, any> = {};

    if (daemon === 'watch_renew') {
      updateData.lastWatchRenewRun = now;
      updateData.watchRenewStatus = status || 'ok';
    } else if (daemon === 'form_process') {
      updateData.lastFormProcessRun = now;
      updateData.formProcessStatus = status || 'ok';
    }

    if (systemStatus) {
      await prisma.systemStatus.update({
        where: { id: systemStatus.id },
        data: updateData,
      });
    } else {
      await prisma.systemStatus.create({
        data: {
          gmailWatchActive: false,
          ...updateData,
        },
      });
    }

    return NextResponse.json({ ok: true, daemon, status, timestamp: now.toISOString() });
  } catch (error: any) {
    console.error('Heartbeat error:', error);
    return NextResponse.json({ error: 'Failed to record heartbeat' }, { status: 500 });
  }
}

/**
 * GET /api/health/heartbeat
 * Public health check - returns daemon statuses and staleness.
 */
export async function GET(req: NextRequest) {
  try {
    const systemStatus = await prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } });

    if (!systemStatus) {
      return NextResponse.json({ healthy: false, message: 'No system status record found' });
    }

    const now = Date.now();
    const WATCH_STALE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days (runs every 2 days)

    const watchAge = systemStatus.lastWatchRenewRun ? now - systemStatus.lastWatchRenewRun.getTime() : null;
    const formAge = systemStatus.lastFormProcessRun ? now - systemStatus.lastFormProcessRun.getTime() : null;

    const watchStale = watchAge === null || watchAge > WATCH_STALE_MS;

    const daemons = {
      watchRenewal: {
        lastRun: systemStatus.lastWatchRenewRun?.toISOString() ?? null,
        status: systemStatus.watchRenewStatus,
        stale: watchStale,
        ageMinutes: watchAge !== null ? Math.round(watchAge / 60000) : null,
        expectedIntervalMinutes: 2 * 24 * 60,
      },
      formProcessor: {
        lastRun: systemStatus.lastFormProcessRun?.toISOString() ?? null,
        status: systemStatus.formProcessStatus,
        stale: false, // event-driven, can't determine staleness easily
        ageMinutes: formAge !== null ? Math.round(formAge / 60000) : null,
        expectedIntervalMinutes: null, // event-driven
      },
    };

    const healthy = !watchStale;
    const staleServices = [
      ...(watchStale ? ['Watch Renewal'] : []),
    ];

    return NextResponse.json({
      healthy,
      staleServices,
      daemons,
      gmailWatch: {
        active: systemStatus.gmailWatchActive,
        expiration: systemStatus.watchExpiration?.toISOString() ?? null,
      },
    });
  } catch (error: any) {
    console.error('Health check error:', error);
    return NextResponse.json({ healthy: false, error: 'Health check failed' }, { status: 500 });
  }
}
