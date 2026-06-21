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
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const [logs, dailyStats] = await Promise.all([
      prisma.formProcessingLog.findMany({
        where: { received_at: { gte: start, lte: end } },
        select: { received_at: true, processing_status: true, processing_time_seconds: true, sender_email: true, target_person: true },
        orderBy: { received_at: 'asc' },
      }).catch(() => []),
      prisma.$queryRaw`
        SELECT DATE(received_at) as date, COUNT(*)::int as count, processing_status as status
        FROM form_processing_logs
        WHERE received_at >= ${start} AND received_at <= ${end}
        GROUP BY DATE(received_at), processing_status
        ORDER BY date ASC
      `.catch(() => []),
    ]);

    const safeItems = (logs as any[]) ?? [];
    const totalInRange = safeItems?.length ?? 0;
    const successCount = safeItems?.filter?.((l: any) => l?.processing_status === 'success')?.length ?? 0;
    const failureCount = safeItems?.filter?.((l: any) => l?.processing_status === 'failed')?.length ?? 0;
    const times = safeItems
      ?.filter?.((l: any) => l?.processing_time_seconds != null)
      ?.map?.((l: any) => Number(l.processing_time_seconds)) ?? [];
    const avgTime = times?.length > 0 ? (times?.reduce?.((a: number, b: number) => a + b, 0) ?? 0) / times.length : 0;

    const senderMap: Record<string, number> = {};
    safeItems?.forEach?.((l: any) => {
      const s = l?.sender_email ?? 'Unknown';
      senderMap[s] = (senderMap[s] ?? 0) + 1;
    });

    const targetMap: Record<string, number> = {};
    safeItems?.forEach?.((l: any) => {
      const t = l?.target_person ?? 'Unknown';
      targetMap[t] = (targetMap[t] ?? 0) + 1;
    });

    const timeBuckets = [
      { label: '0-5s', min: 0, max: 5, count: 0 },
      { label: '5-15s', min: 5, max: 15, count: 0 },
      { label: '15-30s', min: 15, max: 30, count: 0 },
      { label: '30-60s', min: 30, max: 60, count: 0 },
      { label: '60s+', min: 60, max: Infinity, count: 0 },
    ];
    times?.forEach?.((t: number) => {
      const bucket = timeBuckets?.find?.((b: any) => t >= b?.min && t < b?.max);
      if (bucket) bucket.count++;
    });

    return NextResponse.json({
      overview: { totalInRange, successCount, failureCount, avgProcessingTime: Math.round((avgTime ?? 0) * 10) / 10 },
      dailyStats: (dailyStats as any[]) ?? [],
      senderStats: Object.entries(senderMap ?? {})?.map?.(([sender, count]: any) => ({ sender, count })) ?? [],
      targetStats: Object.entries(targetMap ?? {})?.map?.(([target, count]: any) => ({ target, count })) ?? [],
      timeBuckets,
    });
  } catch (error: any) {
    console.error('Stats range API error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
