export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const limit = parseInt(url.searchParams.get('limit') ?? '20');
    const errorType = url.searchParams.get('errorType') ?? undefined;

    const where: any = { processing_status: 'failed' };
    if (errorType && errorType !== 'all') where.error_type = errorType;

    const [errors, total, errorTypes] = await Promise.all([
      prisma.formProcessingLog.findMany({
        where,
        orderBy: { received_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }).catch(() => []),
      prisma.formProcessingLog.count({ where }).catch(() => 0),
      prisma.formProcessingLog.groupBy({
        by: ['error_type'],
        where: { processing_status: 'failed', error_type: { not: null } },
        _count: { id: true },
      }).catch(() => []),
    ]);

    const safeErrors = (errors as any[])?.map?.((e: any) => ({
      id: e?.id ?? 0,
      receivedAt: e?.received_at?.toISOString?.() ?? null,
      senderEmail: e?.sender_email ?? null,
      senderName: e?.sender_name ?? null,
      subject: e?.subject ?? null,
      errorMessage: e?.error_message ?? null,
      errorType: e?.error_type ?? null,
      targetPerson: e?.target_person ?? null,
      processingTimeSeconds: e?.processing_time_seconds != null ? Number(e.processing_time_seconds) : null,
      emailMessageId: e?.email_message_id ?? null,
      instructionsDetected: e?.instructions_detected ?? null,
    })) ?? [];

    return NextResponse.json({
      errors: safeErrors,
      total: total ?? 0,
      page,
      totalPages: Math.ceil((total ?? 0) / limit),
      errorTypes: (errorTypes as any[])?.map?.((e: any) => ({
        type: e?.error_type ?? 'Unknown',
        count: e?._count?.id ?? 0,
      })) ?? [],
    });
  } catch (error: any) {
    console.error('Errors API error:', error);
    return NextResponse.json({ error: 'Failed to fetch errors' }, { status: 500 });
  }
}
