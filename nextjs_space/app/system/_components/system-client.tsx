'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Server,
  Database,
  Mail,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  RefreshCw,
  Wifi,
  Radio,
  Loader2,
  Activity,
  AlertTriangle,
  Zap,
  FileText,
  Heart,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface DaemonInfo {
  lastRun: string | null;
  status: string;
  stale?: boolean;
  ageMinutes: number | null;
}

interface SystemData {
  emailSource: string;
  database: {
    connected: boolean;
    totalRecords: number;
  };
  webhookEnabled: boolean;
  lastSuccessfulForm: string | null;
  lastCloudflareEmail: string | null;
  whitelist: string[];
  daemonHealth?: {
    formProcessor: DaemonInfo;
  };
}

export function SystemClient() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingWebhook, setSavingWebhook] = useState(false);

  const fetchSystem = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/system');
      const json = await res?.json?.();
      setData(json ?? null);
    } catch (e: any) {
      console.error('System fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSystem();
  }, [fetchSystem]);

  const toggleSetting = async (field: 'webhookEnabled', value: boolean) => {
    const setter = setSavingWebhook;
    setter(true);
    try {
      const res = await fetch('/api/system', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        setData(prev => prev ? { ...prev, [field]: value } : prev);
      }
    } catch (e: any) {
      console.error('Toggle error:', e);
    } finally {
      setter(false);
    }
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return 'N/A';
    try { return new Date(d).toLocaleString(); } catch { return 'N/A'; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight flex items-center gap-3">
            <Server className="h-7 w-7 text-teal-400" />
            System Status
          </h1>
          <p className="text-slate-400 mt-1">Health and configuration overview</p>
        </div>
        <Button
          variant="outline"
          onClick={fetchSystem}
          disabled={loading}
          className="border-white/10 text-slate-300 hover:text-white"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Email Intake */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Mail className="h-5 w-5 text-orange-400" />
              Email Intake
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Source</span>
              <Badge variant="outline" className="bg-orange-500/20 text-orange-300 border-orange-500/30">
                {loading ? '...' : 'Cloudflare Email'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Address</span>
              <span className="text-sm text-white font-mono">formclaw@savlil.com</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Reply via</span>
              <span className="text-sm text-white font-mono">Resend API</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Last Email</span>
              <span className="text-sm text-white font-mono">{loading ? '...' : formatDate(data?.lastCloudflareEmail)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Database */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Database className="h-5 w-5 text-teal-400" />
              Database
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Connection</span>
              <Badge variant="outline" className={data?.database?.connected ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'}>
                {loading ? '...' : data?.database?.connected ? 'Connected' : 'Disconnected'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Total Records</span>
              <span className="text-sm text-white font-mono">{loading ? '...' : data?.database?.totalRecords ?? 0}</span>
            </div>
          </CardContent>
        </Card>

        {/* Processing Toggle */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-400" />
              Processing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wifi className="h-4 w-4 text-cyan-400" />
                <div>
                  <p className="text-sm text-white font-medium">Form Processing</p>
                  <p className="text-xs text-slate-500">Cloudflare → Webhook → Fill → Resend</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {savingWebhook && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                <Switch
                  checked={data?.webhookEnabled ?? true}
                  onCheckedChange={(v) => toggleSetting('webhookEnabled', v)}
                  disabled={loading || savingWebhook}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Last Successful Form */}
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-400" />
              Last Successful Form
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {data?.lastSuccessfulForm ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <XCircle className="h-5 w-5 text-slate-600" />
              )}
              <span className="text-white font-mono text-sm">
                {loading ? '...' : formatDate(data?.lastSuccessfulForm)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Daemon Health */}
        <Card className="bg-white/5 border-white/10 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-400" />
              Daemon Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4">
              {[
                {
                  label: 'Form Processor',
                  icon: <FileText className="h-4 w-4 text-teal-400" />,
                  info: data?.daemonHealth?.formProcessor,
                  interval: 'Event-driven (Cloudflare → Webhook)',
                },
              ].map((d) => {
                const info = d.info;
                const isStale = info?.stale === true;
                const statusOk = info?.status === 'ok';
                const statusError = info?.status === 'error';
                const statusUnknown = !info || info?.status === 'unknown';

                const ageText = info?.ageMinutes != null
                  ? info.ageMinutes < 60
                    ? `${info.ageMinutes}m ago`
                    : info.ageMinutes < 1440
                      ? `${Math.round(info.ageMinutes / 60)}h ago`
                      : `${Math.round(info.ageMinutes / 1440)}d ago`
                  : 'Never';

                return (
                  <div key={d.label} className={`rounded-lg p-4 border ${
                    isStale || statusError
                      ? 'bg-red-500/10 border-red-500/30'
                      : statusOk
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-white/5 border-white/10'
                  }`}>
                    <div className="flex items-center gap-2 mb-2">
                      {d.icon}
                      <span className="text-sm font-medium text-white">{d.label}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {statusOk && !isStale && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                        {(isStale || statusError) && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                        {statusUnknown && !isStale && <Clock className="h-3.5 w-3.5 text-slate-500" />}
                        <span className={`text-xs font-mono ${
                          isStale || statusError ? 'text-red-300' : statusOk ? 'text-emerald-300' : 'text-slate-400'
                        }`}>
                          {isStale ? 'STALE' : statusError ? 'ERROR' : statusOk ? 'OK' : 'UNKNOWN'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">Last run: <span className="text-slate-300 font-mono">{loading ? '...' : ageText}</span></p>
                      <p className="text-xs text-slate-500">{d.interval}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Whitelist */}
        <Card className="bg-white/5 border-white/10 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-purple-400" />
              Authorized Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(data?.whitelist ?? [])?.map?.((email: string, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Users className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-slate-300 font-mono text-xs">{email ?? ''}</span>
                </div>
              ))}
              {loading && <div className="h-20 bg-white/5 rounded animate-pulse col-span-full" />}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}