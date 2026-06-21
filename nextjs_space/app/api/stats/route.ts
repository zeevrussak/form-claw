export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalAll, totalSuccess, totalFailure, todayLogs, recentLogs, senderStats, targetStats, dailyStats] = await Promise.all([
      prisma.formProcessingLog.count().catch(() => 0),
      prisma.formProcessingLog.count({ where: { processing_status: 'success' } }).catch(() => 0),
      prisma.formProcessingLog.count({ where: { processing_status: 'failed' } }).catch(() => 0),
      prisma.formProcessingLog.findMany({
        where: { received_at: { gte: today } },
        select: { processing_time_seconds: true, processing_status: true },
      }).catch(() => []),
      prisma.formProcessingLog.findMany({
        where: { received_at: { gte: thirtyDaysAgo } },
        select: { received_at: true, processing_status: true, processing_time_seconds: true, sender_email: true, target_person: true },
        orderBy: { received_at: 'asc' },
      }).catch(() => []),
      prisma.formProcessingLog.groupBy({
        by: ['sender_email'],
        _count: { id: true },
        where: { sender_email: { not: null } },
      }).catch(() => []),
      prisma.formProcessingLog.groupBy({
        by: ['target_person'],
        _count: { id: true },
        where: { target_person: { not: null } },
      }).catch(() => []),
      prisma.$queryRaw`
        SELECT DATE(received_at) as date, COUNT(*)::int as count, processing_status as status
        FROM form_processing_logs
        WHERE received_at >= ${thirtyDaysAgo}
        GROUP BY DATE(received_at), processing_status
        ORDER BY date ASC
      `.catch(() => []),
    ]);

    const safeTodayLogs = (todayLogs as any[]) ?? [];
    const todayCount = safeTodayLogs?.length ?? 0;
    const todayErrors = safeTodayLogs?.filter?.((l: any) => l?.processing_status === 'failed')?.length ?? 0;
    const todayTimes = safeTodayLogs
      ?.filter?.((l: any) => l?.processing_time_seconds != null)
      ?.map?.((l: any) => Number(l.processing_time_seconds)) ?? [];
    const avgTime = todayTimes?.length > 0
      ? (todayTimes?.reduce?.((a: number, b: number) => a + b, 0) ?? 0) / todayTimes.length
      : 0;

    const successRate = (totalAll ?? 0) > 0 ? Math.round(((totalSuccess ?? 0) / (totalAll ?? 1)) * 100) : 0;

    // Processing time distribution
    const safeRecent = (recentLogs as any[]) ?? [];
    const allTimes = safeRecent
      ?.filter?.((l: any) => l?.processing_time_seconds != null)
      ?.map?.((l: any) => Number(l.processing_time_seconds)) ?? [];
    const timeBuckets = [
      { label: '0-5s', min: 0, max: 5, count: 0 },
      { label: '5-15s', min: 5, max: 15, count: 0 },
      { label: '15-30s', min: 15, max: 30, count: 0 },
      { label: '30-60s', min: 30, max: 60, count: 0 },
      { label: '60s+', min: 60, max: Infinity, count: 0 },
    ];
    allTimes?.forEach?.((t: number) => {
      const bucket = timeBuckets?.find?.((b: any) => t >= b?.min && t < b?.max);
      if (bucket) bucket.count++;
    });

    return NextResponse.json({
      overview: {
        totalAll: totalAll ?? 0,
        totalSuccess: totalSuccess ?? 0,
        totalFailure: totalFailure ?? 0,
        successRate,
        todayCount,
        todayErrors,
        avgProcessingTime: Math.round((avgTime ?? 0) * 10) / 10,
      },
      dailyStats: (dailyStats as any[]) ?? [],
      senderStats: (senderStats as any[])?.map?.((s: any) => ({
        sender: s?.sender_email ?? 'Unknown',
        count: s?._count?.id ?? 0,
      })) ?? [],
      targetStats: (targetStats as any[])?.map?.((t: any) => ({
        target: t?.target_person ?? 'Unknown',
        count: t?._count?.id ?? 0,
      })) ?? [],
      timeBuckets,
    });
  } catch (error: any) {
    console.error('Stats API error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
