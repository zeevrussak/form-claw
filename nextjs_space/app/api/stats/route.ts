export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const logsRef = db.collection(COLLECTIONS.LOGS);

  // Get all logs for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [allSnap, recentSnap] = await Promise.all([
    logsRef.count().get(),
    logsRef.where('received_at', '>=', thirtyDaysAgo).get(),
  ]);

  const total = allSnap.data().count;
  const recentDocs = recentSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Calculate stats
  const successCount = recentDocs.filter(d => (d as any).processing_status === 'success').length;
  const failedCount = recentDocs.filter(d => (d as any).processing_status === 'failed').length;

  // Today's stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayDocs = recentDocs.filter(d => {
    const dt = toDate((d as any).received_at);
    return dt && dt >= todayStart;
  });

  // Daily stats (last 30 days)
  const dailyMap: Record<string, { success: number; failure: number; total: number }> = {};
  recentDocs.forEach(d => {
    const dt = toDate((d as any).received_at);
    if (!dt) return;
    const key = dt.toISOString().split('T')[0];
    if (!dailyMap[key]) dailyMap[key] = { success: 0, failure: 0, total: 0 };
    dailyMap[key].total++;
    if ((d as any).processing_status === 'success') dailyMap[key].success++;
    else if ((d as any).processing_status === 'failed') dailyMap[key].failure++;
  });
  const dailyStats = Object.entries(dailyMap)
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Sender breakdown
  const senderMap: Record<string, number> = {};
  recentDocs.forEach(d => {
    const email = (d as any).sender_email || 'unknown';
    senderMap[email] = (senderMap[email] || 0) + 1;
  });
  const senderBreakdown = Object.entries(senderMap)
    .map(([sender, count]) => ({ sender, count }))
    .sort((a, b) => b.count - a.count);

  // Target breakdown
  const targetMap: Record<string, number> = {};
  recentDocs.forEach(d => {
    const target = (d as any).target_person || 'unknown';
    targetMap[target] = (targetMap[target] || 0) + 1;
  });
  const targetBreakdown = Object.entries(targetMap)
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count);

  // Time distribution
  const timeBuckets = [
    { label: '0-5s', min: 0, max: 5, count: 0 },
    { label: '5-15s', min: 5, max: 15, count: 0 },
    { label: '15-30s', min: 15, max: 30, count: 0 },
    { label: '30-60s', min: 30, max: 60, count: 0 },
    { label: '60s+', min: 60, max: Infinity, count: 0 },
  ];
  recentDocs.forEach(d => {
    const time = Number((d as any).processing_time_seconds) || 0;
    for (const b of timeBuckets) {
      if (time >= b.min && time < b.max) { b.count++; break; }
    }
  });

  // Avg processing time
  const successDocs = recentDocs.filter(d => (d as any).processing_status === 'success');
  const avgTime = successDocs.length > 0
    ? successDocs.reduce((sum, d) => sum + (Number((d as any).processing_time_seconds) || 0), 0) / successDocs.length
    : 0;

  return NextResponse.json({
    overview: {
      total,
      recentTotal: recentDocs.length,
      successCount,
      failedCount,
      successRate: recentDocs.length > 0 ? (successCount / recentDocs.length * 100).toFixed(1) : '0',
      avgProcessingTime: avgTime.toFixed(2),
      todayCount: todayDocs.length,
      todayErrors: todayDocs.filter(d => (d as any).processing_status === 'failed').length,
    },
    dailyStats,
    senderBreakdown,
    targetBreakdown,
    timeDistribution: timeBuckets.map(b => ({ label: b.label, count: b.count })),
  });
}
