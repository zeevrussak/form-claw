export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { WHITELISTED_EMAILS } from '@/lib/whitelist';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [systemStatus, lastSuccess, totalLogs, dbCheck] = await Promise.all([
      prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null),
      prisma.formProcessingLog.findFirst({
        where: { processing_status: 'success' },
        orderBy: { received_at: 'desc' },
        select: { received_at: true },
      }).catch(() => null),
      prisma.formProcessingLog.count().catch(() => 0),
      prisma.$queryRaw`SELECT 1 as ok`.then(() => true).catch(() => false),
    ]);

    const now = Date.now();
    const formAge = systemStatus?.lastFormProcessRun ? now - new Date(systemStatus.lastFormProcessRun).getTime() : null;

    return NextResponse.json({
      emailSource: systemStatus?.emailSource ?? 'cloudflare',
      database: {
        connected: dbCheck ?? false,
        totalRecords: totalLogs ?? 0,
      },
      webhookEnabled: systemStatus?.webhookEnabled ?? true,
      lastSuccessfulForm: (lastSuccess as any)?.received_at?.toISOString?.() ?? null,
      lastCloudflareEmail: systemStatus?.lastCloudflareEmail?.toISOString?.() ?? null,
      whitelist: WHITELISTED_EMAILS.filter(e => e !== 'john@doe.com'),
      daemonHealth: {
        formProcessor: {
          lastRun: systemStatus?.lastFormProcessRun?.toISOString?.() ?? null,
          status: systemStatus?.formProcessStatus ?? 'unknown',
          ageMinutes: formAge !== null ? Math.round(formAge / 60000) : null,
        },
      },
    });
  } catch (error: any) {
    console.error('System API error:', error);
    return NextResponse.json({ error: 'Failed to fetch system status' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { webhookEnabled } = body;

    let systemStatus = await prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } });

    const updateData: Record<string, boolean> = {};
    if (typeof webhookEnabled === 'boolean') updateData.webhookEnabled = webhookEnabled;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    if (systemStatus) {
      systemStatus = await prisma.systemStatus.update({
        where: { id: systemStatus.id },
        data: updateData,
      });
    } else {
      systemStatus = await prisma.systemStatus.create({
        data: {
          gmailWatchActive: false,
          ...updateData,
        },
      });
    }

    return NextResponse.json({
      webhookEnabled: systemStatus.webhookEnabled,
    });
  } catch (error: any) {
    console.error('System PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update system settings' }, { status: 500 });
  }
}
