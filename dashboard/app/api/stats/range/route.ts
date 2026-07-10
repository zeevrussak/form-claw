export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
  }

  const db = getDb();
  const snapshot = await db.collection(COLLECTIONS.LOGS)
    .where('received_at', '>=', new Date(startDate))
    .where('received_at', '<=', new Date(endDate + 'T23:59:59Z'))
    .orderBy('received_at', 'desc')
    .get();

  const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  const successCount = docs.filter(d => (d as any).processing_status === 'success').length;
  const failedCount = docs.filter(d => (d as any).processing_status === 'failed').length;

  // Daily stats
  const dailyMap: Record<string, { success: number; failure: number; total: number }> = {};
  docs.forEach(d => {
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

  // Sender/target/time breakdowns (same pattern as main stats)
  const senderMap: Record<string, number> = {};
  const targetMap: Record<string, number> = {};
  const timeBuckets = [
    { label: '0-5s', min: 0, max: 5, count: 0 },
    { label: '5-15s', min: 5, max: 15, count: 0 },
    { label: '15-30s', min: 15, max: 30, count: 0 },
    { label: '30-60s', min: 30, max: 60, count: 0 },
    { label: '60s+', min: 60, max: Infinity, count: 0 },
  ];

  docs.forEach(d => {
    const email = (d as any).sender_email || 'unknown';
    senderMap[email] = (senderMap[email] || 0) + 1;
    const target = (d as any).target_person || 'unknown';
    targetMap[target] = (targetMap[target] || 0) + 1;
    const time = Number((d as any).processing_time_seconds) || 0;
    for (const b of timeBuckets) {
      if (time >= b.min && time < b.max) { b.count++; break; }
    }
  });

  const successDocs = docs.filter(d => (d as any).processing_status === 'success');
  const avgTime = successDocs.length > 0
    ? successDocs.reduce((sum, d) => sum + (Number((d as any).processing_time_seconds) || 0), 0) / successDocs.length
    : 0;

  return NextResponse.json({
    overview: {
      total: docs.length,
      successCount,
      failedCount,
      successRate: docs.length > 0 ? (successCount / docs.length * 100).toFixed(1) : '0',
      avgProcessingTime: avgTime.toFixed(2),
    },
    dailyStats,
    senderBreakdown: Object.entries(senderMap).map(([sender, count]) => ({ sender, count })).sort((a, b) => b.count - a.count),
    targetBreakdown: Object.entries(targetMap).map(([target, count]) => ({ target, count })).sort((a, b) => b.count - a.count),
    timeDistribution: timeBuckets.map(b => ({ label: b.label, count: b.count })),
  });
}
