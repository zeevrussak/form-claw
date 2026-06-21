'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
  FileText,
  Zap,
  Mail,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface OverviewData {
  totalAll: number;
  totalSuccess: number;
  totalFailure: number;
  successRate: number;
  todayCount: number;
  todayErrors: number;
  avgProcessingTime: number;
}

interface SystemData {
  gmailWatch: { active: boolean; expiration: string | null; lastRenewal: string | null };
  database: { connected: boolean; totalRecords: number };
  lastSuccessfulForm: string | null;
}

export function DashboardClient() {
  const { data: session } = useSession() || {};
  const [stats, setStats] = useState<OverviewData | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, systemRes] = await Promise.all([
          fetch('/api/stats').then((r: any) => r?.json?.()).catch(() => null),
          fetch('/api/system').then((r: any) => r?.json?.()).catch(() => null),
        ]);
        setStats(statsRes?.overview ?? null);
        setSystem(systemRes ?? null);
      } catch (e: any) {
        console.error('Dashboard fetch error:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return 'N/A';
    try {
      return new Date(d).toLocaleString();
    } catch {
      return 'N/A';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white tracking-tight">
          Welcome, {session?.user?.name?.split?.(' ')?.[0] ?? 'User'} 👋
        </h1>
        <p className="text-slate-400 mt-1">Here&apos;s what&apos;s happening with your form processing bot.</p>
      </div>

      {/* System Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          icon={<Mail className="h-5 w-5" />}
          label="Gmail Watch"
          value={system?.gmailWatch?.active ? 'Active' : 'Inactive'}
          badge={system?.gmailWatch?.active ? 'success' : 'failure'}
          sub={`Renewal: ${formatDate(system?.gmailWatch?.lastRenewal)}`}
          loading={loading}
        />
        <StatusCard
          icon={<FileText className="h-5 w-5" />}
          label="Total Forms Processed"
          value={String(stats?.totalAll ?? 0)}
          badge="info"
          sub="All time"
          loading={loading}
        />
        <StatusCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Success Rate"
          value={`${stats?.successRate ?? 0}%`}
          badge={(stats?.successRate ?? 0) >= 80 ? 'success' : (stats?.successRate ?? 0) >= 50 ? 'clarification' : 'failure'}
          sub={`${stats?.totalSuccess ?? 0} succeeded, ${stats?.totalFailure ?? 0} failed`}
          loading={loading}
        />
        <StatusCard
          icon={<Zap className="h-5 w-5" />}
          label="Last Successful Form"
          value={system?.lastSuccessfulForm ? 'Completed' : 'None Yet'}
          badge={system?.lastSuccessfulForm ? 'success' : 'info'}
          sub={formatDate(system?.lastSuccessfulForm)}
          loading={loading}
        />
      </div>

      {/* Today's Quick Stats */}
      <div>
        <h2 className="text-lg font-display font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-400" />
          Today&apos;s Activity
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <QuickStatCard
            icon={<Activity className="h-5 w-5 text-blue-400" />}
            label="Forms Processed"
            value={stats?.todayCount ?? 0}
            loading={loading}
          />
          <QuickStatCard
            icon={<Clock className="h-5 w-5 text-teal-400" />}
            label="Avg Processing Time"
            value={`${stats?.avgProcessingTime ?? 0}s`}
            loading={loading}
          />
          <QuickStatCard
            icon={<AlertTriangle className="h-5 w-5 text-red-400" />}
            label="Errors Today"
            value={stats?.todayErrors ?? 0}
            loading={loading}
          />
        </div>
      </div>

      {/* DB Status */}
      <div>
        <h2 className="text-lg font-display font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-teal-400" />
          System Health
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-white/5 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Database</p>
                  <p className="text-lg font-semibold text-white mt-1">
                    {loading ? '...' : system?.database?.connected ? 'Connected' : 'Disconnected'}
                  </p>
                </div>
                <Badge variant={system?.database?.connected ? 'default' : 'destructive'} className={system?.database?.connected ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : ''}>
                  {system?.database?.connected ? 'Healthy' : 'Error'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-2">{system?.database?.totalRecords ?? 0} records in database</p>
            </CardContent>
          </Card>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Gmail Watch Expiration</p>
                  <p className="text-lg font-semibold text-white mt-1">
                    {loading ? '...' : formatDate(system?.gmailWatch?.expiration)}
                  </p>
                </div>
                <Badge variant="outline" className="border-blue-500/30 text-blue-300">
                  Watch
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon, label, value, badge, sub, loading }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge: string;
  sub: string;
  loading: boolean;
}) {
  const badgeColors: Record<string, string> = {
    success: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    failure: 'bg-red-500/20 text-red-300 border-red-500/30',
    clarification: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    info: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  };

  return (
    <Card className="bg-white/5 border-white/10 hover:bg-white/[0.07] transition-colors">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-3">
          <div className="p-2 rounded-lg bg-white/5 text-slate-400">{icon}</div>
          <Badge variant="outline" className={badgeColors[badge] ?? badgeColors.info}>
            {loading ? '...' : value}
          </Badge>
        </div>
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <p className="text-xs text-slate-500 mt-1">{loading ? 'Loading...' : sub}</p>
      </CardContent>
    </Card>
  );
}

function QuickStatCard({ icon, label, value, loading }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardContent className="pt-6 flex items-center gap-4">
        <div className="p-3 rounded-xl bg-white/5">{icon}</div>
        <div>
          <p className="text-2xl font-bold text-white font-mono">{loading ? '...' : value}</p>
          <p className="text-sm text-slate-400">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
