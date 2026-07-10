'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  Eye,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Log {
  id: number;
  emailMessageId: string;
  receivedAt: string | null;
  senderEmail: string | null;
  senderName: string | null;
  subject: string | null;
  attachmentFilename: string | null;
  attachmentType: string | null;
  attachmentCount: number;
  pageCount: number | null;
  targetPerson: string | null;
  signer: string | null;
  processingStatus: string;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingTimeSeconds: number | null;
  filledPdfFilename: string | null;
  errorMessage: string | null;
  errorType: string | null;
  instructionsDetected: string | null;
  markedAsRead: boolean;
  createdAt: string | null;
}

export function ActivityClient() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search) params.set('search', search);

      const res = await fetch(`/api/logs?${params.toString()}`);
      const data = await res?.json?.();
      setLogs(data?.logs ?? []);
      setTotal(data?.total ?? 0);
      setTotalPages(data?.totalPages ?? 1);
    } catch (e: any) {
      console.error('Fetch logs error:', e);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const statusBadge = (status: string) => {
    const s = status?.toLowerCase?.() ?? '';
    const map: Record<string, string> = {
      completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      failed: 'bg-red-500/20 text-red-300 border-red-500/30',
      processing: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      clarification: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    };
    return map[s] ?? map.pending;
  };

  const formatTime = (d: string | null | undefined) => {
    if (!d) return '-';
    try { return new Date(d).toLocaleString(); } catch { return '-'; }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-white tracking-tight flex items-center gap-3">
          <Activity className="h-7 w-7 text-blue-400" />
          Activity Log
        </h1>
        <p className="text-slate-400 mt-1">Recent form processing events</p>
      </div>

      {/* Filters */}
      <Card className="bg-white/5 border-white/10">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search by subject..."
                value={search}
                onChange={(e: any) => { setSearch(e?.target?.value ?? ''); setPage(1); }}
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-slate-500"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v: string) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full md:w-40 bg-white/5 border-white/10 text-white">
                <Filter className="h-4 w-4 mr-2 text-slate-500" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left p-4 text-slate-400 font-medium">Timestamp</th>
                <th className="text-left p-4 text-slate-400 font-medium">Sender</th>
                <th className="text-left p-4 text-slate-400 font-medium">Subject</th>
                <th className="text-left p-4 text-slate-400 font-medium">Status</th>
                <th className="text-left p-4 text-slate-400 font-medium">Time</th>
                <th className="text-left p-4 text-slate-400 font-medium">Target</th>
                <th className="text-left p-4 text-slate-400 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 })?.map?.((_: any, i: number) => (
                  <tr key={i} className="border-b border-white/5">
                    {Array.from({ length: 7 })?.map?.((__: any, j: number) => (
                      <td key={j} className="p-4"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : (logs?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">No activity logs found</td>
                </tr>
              ) : (
                logs?.map?.((log: Log) => (
                  <tr
                    key={log?.id}
                    className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer transition-colors"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="p-4 text-slate-300 font-mono text-xs whitespace-nowrap">{formatTime(log?.receivedAt)}</td>
                    <td className="p-4 text-slate-300 truncate max-w-[150px]">{log?.senderName ?? log?.senderEmail ?? '-'}</td>
                    <td className="p-4 text-white truncate max-w-[200px]">{log?.subject ?? '-'}</td>
                    <td className="p-4">
                      <Badge variant="outline" className={statusBadge(log?.processingStatus ?? '')}>
                        {log?.processingStatus ?? 'unknown'}
                      </Badge>
                    </td>
                    <td className="p-4 text-slate-300 font-mono">{log?.processingTimeSeconds != null ? `${log.processingTimeSeconds}s` : '-'}</td>
                    <td className="p-4 text-slate-300">{log?.targetPerson ?? '-'}</td>
                    <td className="p-4">
                      <Button variant="ghost" size="sm" className="text-slate-500 hover:text-white">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between p-4 border-t border-white/10">
          <p className="text-sm text-slate-500">{total} total records</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p: number) => Math.max(1, p - 1))} className="border-white/10 text-slate-400">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p: number) => p + 1)} className="border-white/10 text-slate-400">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedLog(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e: any) => e?.stopPropagation?.()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-display font-bold text-white">Log Details</h3>
              <button onClick={() => setSelectedLog(null)} className="text-slate-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <DetailRow label="Received At" value={formatTime(selectedLog?.receivedAt)} />
              <DetailRow label="Sender" value={selectedLog?.senderName ? `${selectedLog.senderName} (${selectedLog?.senderEmail ?? ''})` : selectedLog?.senderEmail} />
              <DetailRow label="Subject" value={selectedLog?.subject} />
              <DetailRow label="Status">
                <Badge variant="outline" className={statusBadge(selectedLog?.processingStatus ?? '')}>
                  {selectedLog?.processingStatus}
                </Badge>
              </DetailRow>
              <DetailRow label="Processing Time" value={selectedLog?.processingTimeSeconds != null ? `${selectedLog.processingTimeSeconds}s` : 'N/A'} />
              <DetailRow label="Target Person" value={selectedLog?.targetPerson} />
              <DetailRow label="Signer" value={selectedLog?.signer} />
              <DetailRow label="Attachment" value={selectedLog?.attachmentFilename} />
              <DetailRow label="Pages" value={selectedLog?.pageCount != null ? String(selectedLog.pageCount) : null} />
              <DetailRow label="Filled PDF" value={selectedLog?.filledPdfFilename} />
              <DetailRow label="Email Message ID" value={selectedLog?.emailMessageId} />
              {selectedLog?.errorMessage && <DetailRow label="Error" value={selectedLog.errorMessage} />}
              {selectedLog?.instructionsDetected && <DetailRow label="Instructions" value={selectedLog.instructionsDetected} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      {children ?? <span className="text-sm text-white break-all">{value ?? 'N/A'}</span>}
    </div>
  );
}
