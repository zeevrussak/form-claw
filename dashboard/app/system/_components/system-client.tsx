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
  Loader2,
  AlertTriangle,
  Zap,
  FileText,
  Heart,
  Play,
  Inbox,
  ArrowRight,
  ChevronDown,
  ChevronUp,
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

interface TestStep {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  detail: string;
  durationMs: number | null;
}

interface TestResult {
  steps: TestStep[];
  overallStatus: string;
  totalDurationMs: number;
  startedAt: string;
  completedAt: string;
  recentLogs?: any[];
}

interface IntakeEvent {
  datetime: string;
  status: string;
  requests: number;
  subrequests: number;
  errors: number;
  forwarded: boolean;
}

interface IntakeData {
  workerStats: {
    period: string;
    totalInvocations: number;
    totalErrors: number;
    totalSubrequests: number;
    totalDropped: number;
    totalExceptions: number;
    events: IntakeEvent[];
  } | null;
  recentProcessed: {
    id: string;
    sender: string;
    subject: string;
    status: string;
    errorType: string | null;
    errorMessage: string | null;
    target: string | null;
    processingTime: number | null;
    receivedAt: string;
  }[];
  workerError: string | null;
}

export function SystemClient() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [activeTab, setActiveTab] = useState<'status' | 'intake' | 'e2e'>('status');

  // E2E test state
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Intake state
  const [intakeData, setIntakeData] = useState<IntakeData | null>(null);
  const [intakeLoading, setIntakeLoading] = useState(false);

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

  const fetchIntake = useCallback(async () => {
    setIntakeLoading(true);
    try {
      const res = await fetch('/api/intake');
      const json = await res?.json?.();
      setIntakeData(json ?? null);
    } catch (e: any) {
      console.error('Intake fetch error:', e);
    } finally {
      setIntakeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'intake') fetchIntake();
  }, [activeTab, fetchIntake]);

  const runE2ETest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/e2e-test', { method: 'POST' });
      const json = await res?.json?.();
      setTestResult(json ?? null);
    } catch (e: any) {
      console.error('E2E test error:', e);
    } finally {
      setTestRunning(false);
    }
  };

  const toggleSetting = async (field: 'webhookEnabled', value: boolean) => {
    setSavingWebhook(true);
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
      setSavingWebhook(false);
    }
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return 'N/A';
    try { return new Date(d).toLocaleString(); } catch { return 'N/A'; }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'success': case 'completed': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'failed': case 'error': return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'dropped': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'processing': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      default: return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    }
  };

  const stepIcon = (status: string) => {
    switch (status) {
      case 'pass': return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
      case 'fail': return <XCircle className="h-4 w-4 text-red-400" />;
      case 'warn': return <AlertTriangle className="h-4 w-4 text-amber-400" />;
      default: return <Clock className="h-4 w-4 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight flex items-center gap-3">
            <Server className="h-7 w-7 text-teal-400" />
            System Status
          </h1>
          <p className="text-slate-400 mt-1">Health, intake monitoring, and end-to-end tests</p>
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

      {/* Tab navigation */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-lg">
        {[
          { key: 'status' as const, label: 'System Status', icon: <Server className="h-4 w-4" /> },
          { key: 'intake' as const, label: 'Email Intake', icon: <Inbox className="h-4 w-4" /> },
          { key: 'e2e' as const, label: 'E2E Tests', icon: <Play className="h-4 w-4" /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* System Status Tab */}
      {activeTab === 'status' && (
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
                {[{
                  label: 'Form Processor',
                  icon: <FileText className="h-4 w-4 text-teal-400" />,
                  info: data?.daemonHealth?.formProcessor,
                  interval: 'Event-driven (Cloudflare → Webhook)',
                }].map((d) => {
                  const info = d.info;
                  const isStale = info?.stale === true;
                  const statusOk = info?.status === 'ok';
                  const statusError = info?.status === 'error';
                  const statusUnknown = !info || info?.status === 'unknown';
                  const ageText = info?.ageMinutes != null
                    ? info.ageMinutes < 60 ? `${info.ageMinutes}m ago`
                      : info.ageMinutes < 1440 ? `${Math.round(info.ageMinutes / 60)}h ago`
                        : `${Math.round(info.ageMinutes / 1440)}d ago`
                    : 'Never';
                  return (
                    <div key={d.label} className={`rounded-lg p-4 border ${
                      isStale || statusError ? 'bg-red-500/10 border-red-500/30'
                        : statusOk ? 'bg-emerald-500/10 border-emerald-500/30'
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
      )}

      {/* Email Intake Tab */}
      {activeTab === 'intake' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Inbox className="h-5 w-5 text-orange-400" />
              Email Intake Monitor
            </h2>
            <Button
              variant="outline"
              onClick={fetchIntake}
              disabled={intakeLoading}
              className="border-white/10 text-slate-300 hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${intakeLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* Worker Stats Summary */}
          {intakeData?.workerStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Total Received', value: intakeData.workerStats.totalInvocations, color: 'text-white' },
                { label: 'Forwarded', value: intakeData.workerStats.totalSubrequests, color: 'text-emerald-400' },
                { label: 'Dropped (No PDF)', value: intakeData.workerStats.totalDropped, color: 'text-amber-400' },
                { label: 'Exceptions', value: intakeData.workerStats.totalExceptions, color: 'text-red-400' },
                { label: 'Errors', value: intakeData.workerStats.totalErrors, color: 'text-red-400' },
              ].map(s => (
                <Card key={s.label} className="bg-white/5 border-white/10">
                  <CardContent className="pt-4">
                    <p className="text-xs text-slate-400">{s.label}</p>
                    <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-slate-500">Last 7 days</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {intakeData?.workerError && (
            <Card className="bg-amber-500/10 border-amber-500/30">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                  <span className="text-amber-300 text-sm">{intakeData.workerError}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Worker Events Timeline */}
          {intakeData?.workerStats?.events && intakeData.workerStats.events.length > 0 && (
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-base">Worker Invocations (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {intakeData.workerStats.events.map((evt, i) => (
                    <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-md border ${
                      evt.status === 'scriptThrewException'
                        ? 'bg-red-500/10 border-red-500/20'
                        : evt.forwarded
                          ? 'bg-emerald-500/10 border-emerald-500/20'
                          : 'bg-amber-500/10 border-amber-500/20'
                    }`}>
                      <div className="flex items-center gap-3">
                        {evt.status === 'scriptThrewException'
                          ? <XCircle className="h-4 w-4 text-red-400" />
                          : evt.forwarded
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            : <AlertTriangle className="h-4 w-4 text-amber-400" />
                        }
                        <span className="text-sm text-white font-mono">
                          {new Date(evt.datetime).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-slate-400">{evt.requests} req</span>
                        <span className={evt.forwarded ? 'text-emerald-400' : 'text-amber-400'}>
                          {evt.forwarded ? 'Forwarded' : evt.status === 'scriptThrewException' ? 'Exception' : 'Dropped'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Processed Logs */}
          {intakeData?.recentProcessed && intakeData.recentProcessed.length > 0 && (
            <Card className="bg-white/5 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-base">Recent Processing Logs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {intakeData.recentProcessed.map((log) => (
                    <div key={log.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-white/5 border border-white/10">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Badge variant="outline" className={`shrink-0 ${statusColor(log.status)}`}>
                          {log.status}
                        </Badge>
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{log.subject || '(no subject)'}</p>
                          <p className="text-xs text-slate-400">{log.sender}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs shrink-0 ml-4">
                        {log.target && <span className="text-teal-300">{log.target}</span>}
                        {log.processingTime != null && <span className="text-slate-400 font-mono">{log.processingTime}s</span>}
                        <span className="text-slate-500 font-mono">{formatDate(log.receivedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {intakeLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              <span className="ml-2 text-slate-400">Loading intake data...</span>
            </div>
          )}
        </div>
      )}

      {/* E2E Tests Tab */}
      {activeTab === 'e2e' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-cyan-400" />
              End-to-End Tests
            </h2>
            <Button
              onClick={runE2ETest}
              disabled={testRunning}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {testRunning ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</>
              ) : (
                <><Play className="h-4 w-4 mr-2" /> Run Tests</>
              )}
            </Button>
          </div>

          <p className="text-sm text-slate-400">
            Tests check each component of the Form Claw pipeline: Processor health, Firestore connectivity,
            Resend API validity, webhook endpoint reachability, and recent log analysis.
          </p>

          {testResult && (
            <Card className={`border ${
              testResult.overallStatus === 'pass' ? 'bg-emerald-500/10 border-emerald-500/30'
                : testResult.overallStatus === 'warn' ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-red-500/10 border-red-500/30'
            }`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    {testResult.overallStatus === 'pass'
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                      : testResult.overallStatus === 'warn'
                        ? <AlertTriangle className="h-5 w-5 text-amber-400" />
                        : <XCircle className="h-5 w-5 text-red-400" />
                    }
                    {testResult.overallStatus === 'pass' ? 'All Tests Passed'
                      : testResult.overallStatus === 'warn' ? 'Tests Passed with Warnings'
                        : 'Tests Failed'
                    }
                  </CardTitle>
                  <span className="text-xs text-slate-400 font-mono">
                    {testResult.totalDurationMs}ms
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {testResult.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-md bg-white/5">
                      <div className="mt-0.5">{stepIcon(step.status)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-white">{step.name}</span>
                          {step.durationMs != null && (
                            <span className="text-xs text-slate-500 font-mono">{step.durationMs}ms</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 break-all">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!testResult && !testRunning && (
            <Card className="bg-white/5 border-white/10">
              <CardContent className="py-12 text-center">
                <Play className="h-12 w-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">Click "Run Tests" to check the full pipeline health</p>
              </CardContent>
            </Card>
          )}

          {testRunning && (
            <Card className="bg-white/5 border-white/10">
              <CardContent className="py-12 text-center">
                <Loader2 className="h-12 w-12 text-cyan-400 mx-auto mb-3 animate-spin" />
                <p className="text-slate-400">Running end-to-end checks...</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
