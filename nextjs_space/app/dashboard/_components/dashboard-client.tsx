'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  FileText,
  Mail,
  Users,
  Brain,
  Settings,
  Server,
  Activity,
  BarChart3,
  ArrowRight,
  Loader2,
  Zap,
  Clock,
  Send,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
  database: { connected: boolean; totalRecords: number };
  lastSuccessfulForm: string | null;
  webhookEnabled: boolean;
  emailSource: string;
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

  const isOnline = system?.database?.connected && system?.webhookEnabled;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white tracking-tight">
          Welcome, {session?.user?.name?.split?.(' ')?.[0] ?? 'User'} 👋
        </h1>
        <p className="text-slate-400 mt-1">Form Claw automated form-filling service overview.</p>
      </div>

      {/* Service Status Banner */}
      <Card className={`border ${isOnline ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${isOnline ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
              {loading ? (
                <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
              ) : isOnline ? (
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              ) : (
                <XCircle className="h-8 w-8 text-red-400" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                {loading ? 'Checking...' : isOnline ? 'Service Online' : 'Service Offline'}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">
                {loading ? 'Connecting to services...' : isOnline
                  ? 'All systems operational — emails are being processed automatically.'
                  : 'Some services are not responding. Check the System page for details.'}
              </p>
            </div>
            <div className="ml-auto hidden sm:flex items-center gap-3">
              <Badge variant="outline" className={isOnline ? 'border-emerald-500/30 text-emerald-300' : 'border-red-500/30 text-red-300'}>
                {loading ? '...' : isOnline ? 'Operational' : 'Degraded'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <QuickStat
          icon={<FileText className="h-5 w-5 text-blue-400" />}
          label="Total Processed"
          value={stats?.totalAll ?? 0}
          loading={loading}
        />
        <QuickStat
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          label="Success Rate"
          value={`${stats?.successRate ?? 0}%`}
          loading={loading}
        />
        <QuickStat
          icon={<Zap className="h-5 w-5 text-amber-400" />}
          label="Today"
          value={stats?.todayCount ?? 0}
          loading={loading}
        />
        <QuickStat
          icon={<Clock className="h-5 w-5 text-teal-400" />}
          label="Avg Time"
          value={`${stats?.avgProcessingTime ?? 0}s`}
          loading={loading}
        />
      </div>

      {/* How to Use */}
      <Card className="bg-white/5 border-white/10">
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Send className="h-5 w-5 text-blue-400" />
            How to Use
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StepCard
              number={1}
              title="Send an Email"
              description={'Send a PDF form as an attachment to formclaw@savlil.com from an approved email address.'}
            />
            <StepCard
              number={2}
              title="Add Instructions"
              description={'In the subject or body, specify who the form is for and who should sign (e.g. \'Fill for Savyon by Keren\').'}
            />
            <StepCard
              number={3}
              title="Get the Filled Form"
              description={'Within minutes, you\'ll receive a reply email with the filled PDF attached. Check for accuracy!'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Quick Navigation */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blue-400" />
          Quick Access
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <NavCard href="/activity" icon={Activity} label="Activity Log" description="View recent form processing history" color="text-blue-400" />
          <NavCard href="/statistics" icon={BarChart3} label="Statistics" description="Charts and analytics" color="text-purple-400" />
          <NavCard href="/errors" icon={AlertTriangle} label="Error Log" description="Review processing failures" color="text-red-400" />
          <NavCard href="/knowledge" icon={Brain} label="Knowledge Base" description="Family data and facts" color="text-teal-400" />
          <NavCard href="/team" icon={Users} label="Team" description="Members and approved emails" color="text-emerald-400" />
          <NavCard href="/system" icon={Server} label="System" description="Technical status and configuration" color="text-amber-400" />
        </div>
      </div>
    </div>
  );
}

function QuickStat({ icon, label, value, loading }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardContent className="pt-5 pb-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-white/5">{icon}</div>
        <div>
          <p className="text-xl font-bold text-white font-mono">{loading ? '...' : value}</p>
          <p className="text-xs text-slate-400">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StepCard({ number, title, description }: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5">
      <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-300 text-sm font-bold flex-shrink-0">
        {number}
      </div>
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function NavCard({ href, icon: Icon, label, description, color }: {
  href: string;
  icon: any;
  label: string;
  description: string;
  color: string;
}) {
  return (
    <Link href={href}>
      <Card className="bg-white/5 border-white/10 hover:bg-white/[0.08] hover:border-white/15 transition-all group cursor-pointer">
        <CardContent className="pt-5 pb-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/5">
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">{label}</p>
            <p className="text-xs text-slate-500 truncate">{description}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
        </CardContent>
      </Card>
    </Link>
  );
}
