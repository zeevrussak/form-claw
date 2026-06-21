'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import dynamic from 'next/dynamic';

const DailyChart = dynamic(() => import('./daily-chart'), { ssr: false, loading: () => <ChartSkeleton /> });
const StatusPieChart = dynamic(() => import('./status-pie-chart'), { ssr: false, loading: () => <ChartSkeleton /> });
const TimeDistChart = dynamic(() => import('./time-dist-chart'), { ssr: false, loading: () => <ChartSkeleton /> });
const SenderChart = dynamic(() => import('./sender-chart'), { ssr: false, loading: () => <ChartSkeleton /> });
const TargetPieChart = dynamic(() => import('./target-pie-chart'), { ssr: false, loading: () => <ChartSkeleton /> });

function ChartSkeleton() {
  return <div className="h-64 bg-white/5 rounded-xl animate-pulse" />;
}

interface StatsData {
  overview: any;
  dailyStats: any[];
  senderStats: any[];
  targetStats: any[];
  timeBuckets: any[];
}

export function StatisticsClient() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCustomRange, setIsCustomRange] = useState(false);

  const fetchStats = async (custom = false) => {
    setLoading(true);
    try {
      let url = '/api/stats';
      if (custom && startDate && endDate) {
        url = `/api/stats/range?startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await fetch(url);
      const json = await res?.json?.();
      setData(json ?? null);
    } catch (e: any) {
      console.error('Stats fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleCustomRange = () => {
    if (startDate && endDate) {
      setIsCustomRange(true);
      fetchStats(true);
    }
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    setIsCustomRange(false);
    fetchStats(false);
  };

  // Process daily data for chart
  const dailyData = processDailyStats(data?.dailyStats ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-white tracking-tight flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-blue-400" />
          Statistics
        </h1>
        <p className="text-slate-400 mt-1">Charts and analytics for form processing</p>
      </div>

      {/* Date Range Selector */}
      <Card className="bg-white/5 border-white/10">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1 block">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e: any) => setStartDate(e?.target?.value ?? '')}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1 block">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e: any) => setEndDate(e?.target?.value ?? '')}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <Button onClick={handleCustomRange} className="shrink-0">
              <Calendar className="h-4 w-4 mr-2" />
              Apply
            </Button>
            {isCustomRange && (
              <Button variant="outline" onClick={handleReset} className="shrink-0 border-white/10 text-slate-400">
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Line Chart */}
        <Card className="bg-white/5 border-white/10 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-base">Forms Processed Per Day (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {loading ? <ChartSkeleton /> : <DailyChart data={dailyData} />}
            </div>
          </CardContent>
        </Card>

        {/* Success/Failure Pie */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">Success vs Failure Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {loading ? <ChartSkeleton /> : (
                <StatusPieChart
                  success={data?.overview?.totalSuccess ?? data?.overview?.successCount ?? 0}
                  failure={data?.overview?.totalFailure ?? data?.overview?.failureCount ?? 0}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Time Distribution */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">Processing Time Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {loading ? <ChartSkeleton /> : <TimeDistChart data={data?.timeBuckets ?? []} />}
            </div>
          </CardContent>
        </Card>

        {/* Sender Bar */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">Forms Per Sender</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {loading ? <ChartSkeleton /> : <SenderChart data={data?.senderStats ?? []} />}
            </div>
          </CardContent>
        </Card>

        {/* Target Pie */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">Forms Per Target Person</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {loading ? <ChartSkeleton /> : <TargetPieChart data={data?.targetStats ?? []} />}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function processDailyStats(raw: any[]): any[] {
  if (!raw || (raw?.length ?? 0) === 0) return [];
  const map: Record<string, { date: string; success: number; failure: number; total: number }> = {};
  (raw ?? [])?.forEach?.((item: any) => {
    const dateStr = item?.date ? (typeof item.date === 'string' ? item.date?.split?.('T')?.[0] : new Date(item.date)?.toISOString?.()?.split?.('T')?.[0]) : '';
    if (!dateStr) return;
    if (!map[dateStr]) map[dateStr] = { date: dateStr, success: 0, failure: 0, total: 0 };
    const count = item?.count ?? 0;
    if (item?.status === 'completed') map[dateStr].success += count;
    else if (item?.status === 'failed') map[dateStr].failure += count;
    map[dateStr].total += count;
  });
  return Object.values(map ?? {})?.sort?.((a: any, b: any) => (a?.date ?? '').localeCompare(b?.date ?? '')) ?? [];
}
