export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const errors = await prisma.formProcessingLog.findMany({
      where: { processing_status: 'failed' },
      orderBy: { received_at: 'desc' },
    }).catch(() => []);

    const safeErrors = (errors as any[]) ?? [];
    const headers = ['Timestamp', 'Sender Email', 'Subject', 'Error Type', 'Error Message', 'Target Person'];
    const rows = safeErrors?.map?.((e: any) => [
      e?.received_at?.toISOString?.() ?? '',
      e?.sender_email ?? '',
      (e?.subject ?? '')?.replace?.(/,/g, ';') ?? '',
      e?.error_type ?? '',
      (e?.error_message ?? '')?.replace?.(/,/g, ';')?.replace?.(/\n/g, ' ') ?? '',
      e?.target_person ?? '',
    ]?.join(',')) ?? [];

    const csv = [headers?.join(','), ...(rows ?? [])]?.join?.('\n') ?? '';

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=error_logs.csv',
      },
    });
  } catch (error: any) {
    console.error('CSV export error:', error);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
