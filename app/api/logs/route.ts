export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Decimal } from '@prisma/client/runtime/library';

function safeDecimal(val: Decimal | null | undefined): number | null {
  if (val == null) return null;
  return Number(val);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') ?? '1');
    const limit = parseInt(url.searchParams.get('limit') ?? '20');
    const status = url.searchParams.get('status') ?? undefined;
    const sender = url.searchParams.get('sender') ?? undefined;
    const search = url.searchParams.get('search') ?? undefined;
    const startDate = url.searchParams.get('startDate') ?? undefined;
    const endDate = url.searchParams.get('endDate') ?? undefined;

    const where: any = {};
    if (status && status !== 'all') where.processing_status = status;
    if (sender && sender !== 'all') where.sender_email = sender;
    if (search) where.subject = { contains: search, mode: 'insensitive' as any };
    if (startDate || endDate) {
      where.received_at = {};
      if (startDate) where.received_at.gte = new Date(startDate);
      if (endDate) where.received_at.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.formProcessingLog.findMany({
        where,
        orderBy: { received_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.formProcessingLog.count({ where }),
    ]);

    const safeLogs = (logs ?? [])?.map?.((log: any) => ({
      id: log?.id ?? 0,
      emailMessageId: log?.email_message_id ?? '',
      receivedAt: log?.received_at?.toISOString?.() ?? null,
      senderEmail: log?.sender_email ?? null,
      senderName: log?.sender_name ?? null,
      subject: log?.subject ?? null,
      attachmentFilename: log?.attachment_filename ?? null,
      attachmentType: log?.attachment_type ?? null,
      attachmentCount: log?.attachment_count ?? 0,
      pageCount: log?.page_count ?? null,
      targetPerson: log?.target_person ?? null,
      signer: log?.signer ?? null,
      processingStatus: log?.processing_status ?? 'unknown',
      processingStartedAt: log?.processing_started_at?.toISOString?.() ?? null,
      processingCompletedAt: log?.processing_completed_at?.toISOString?.() ?? null,
      processingTimeSeconds: safeDecimal(log?.processing_time_seconds),
      filledPdfFilename: log?.filled_pdf_filename ?? null,
      errorMessage: log?.error_message ?? null,
      errorType: log?.error_type ?? null,
      instructionsDetected: log?.instructions_detected ?? null,
      markedAsRead: log?.marked_as_read ?? false,
      createdAt: log?.created_at?.toISOString?.() ?? null,
    })) ?? [];

    return NextResponse.json({
      logs: safeLogs,
      total: total ?? 0,
      page,
      totalPages: Math.ceil((total ?? 0) / limit),
    });
  } catch (error: any) {
    console.error('Logs API error:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
