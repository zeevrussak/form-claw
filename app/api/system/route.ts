export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [systemStatus, lastSuccess, totalLogs, dbCheck] = await Promise.all([
      prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } }).catch(() => null),
      prisma.formProcessingLog.findFirst({
        where: { processing_status: 'completed' },
        orderBy: { received_at: 'desc' },
        select: { received_at: true },
      }).catch(() => null),
      prisma.formProcessingLog.count().catch(() => 0),
      prisma.$queryRaw`SELECT 1 as ok`.then(() => true).catch(() => false),
    ]);

    return NextResponse.json({
      gmailWatch: {
        active: systemStatus?.gmailWatchActive ?? false,
        expiration: systemStatus?.watchExpiration?.toISOString?.() ?? null,
        lastRenewal: systemStatus?.lastWatchRenewal?.toISOString?.() ?? null,
      },
      database: {
        connected: dbCheck ?? false,
        totalRecords: totalLogs ?? 0,
      },
<<<<<<< HEAD
=======
      pollingEnabled: systemStatus?.pollingEnabled ?? false,
      webhookEnabled: systemStatus?.webhookEnabled ?? true,
>>>>>>> 72c35ee (v1.2: Add polling/webhook toggles, security filter, update docs)
      lastSuccessfulForm: (lastSuccess as any)?.received_at?.toISOString?.() ?? null,
      whitelist: [
        'k6622024@gmail.com',
        'targetmailbox@gmail.com',
        '2396119@gmail.com',
        'zeev@infiniplex.life',
        'russakbot@gmail.com',
      ],
    });
  } catch (error: any) {
    console.error('System API error:', error);
    return NextResponse.json({ error: 'Failed to fetch system status' }, { status: 500 });
  }
}
<<<<<<< HEAD
=======

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { pollingEnabled, webhookEnabled } = body;

    // Find or create the system status row
    let systemStatus = await prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } });

    const updateData: Record<string, boolean> = {};
    if (typeof pollingEnabled === 'boolean') updateData.pollingEnabled = pollingEnabled;
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
      pollingEnabled: systemStatus.pollingEnabled,
      webhookEnabled: systemStatus.webhookEnabled,
    });
  } catch (error: any) {
    console.error('System PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update system settings' }, { status: 500 });
  }
}
>>>>>>> 72c35ee (v1.2: Add polling/webhook toggles, security filter, update docs)
