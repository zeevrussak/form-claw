'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AlertCircle,
  Download,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ErrorLog {
  id: number;
  receivedAt: string | null;
  senderEmail: string | null;
  senderName: string | null;
  subject: string | null;
  errorMessage: string | null;
  errorType: string | null;
  targetPerson: string | null;
  processingTimeSeconds: number | null;
  emailMessageId: string | null;
  instructionsDetected: string | null;
}

export function ErrorsClient() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorTypeFilter, setErrorTypeFilter] = useState('all');
  const [errorTypes, setErrorTypes] = useState<{ type: string; count: number }[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (errorTypeFilter !== 'all') params.set('errorType', errorTypeFilter);

      const res = await fetch(`/api/errors?${params.toString()}`);
      const data = await res?.json?.();
      setErrors(data?.errors ?? []);
      setTotal(data?.total ?? 0);
      setTotalPages(data?.totalPages ?? 1);
      setErrorTypes(data?.errorTypes ?? []);
    } catch (e: any) {
      console.error('Fetch errors error:', e);
    } finally {
      setLoading(false);
    }
  }, [page, errorTypeFilter]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  const handleExport = async () => {
    try {
      const res = await fetch('/api/errors/export');
      const blob = await res?.blob?.();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'error_logs.csv';
        a?.click?.();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      console.error('Export error:', e);
    }
  };

  const formatTime = (d: string | null | undefined) => {
    if (!d) return '-';
    try { return new Date(d).toLocaleString(); } catch { return '-'; }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight flex items-center gap-3">
            <AlertCircle className="h-7 w-7 text-red-400" />
            Error Log
          </h1>
          <p className="text-slate-400 mt-1">Failed form processing attempts</p>
        </div>
        <Button onClick={handleExport} variant="outline" className="border-white/10 text-slate-300 hover:text-white">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filter */}
      <Card className="bg-white/5 border-white/10">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Select value={errorTypeFilter} onValueChange={(v: string) => { setErrorTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-60 bg-white/5 border-white/10 text-white">
                <Filter className="h-4 w-4 mr-2 text-slate-500" />
                <SelectValue placeholder="Error Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Error Types</SelectItem>
                {errorTypes?.map?.((et: any) => (
                  <SelectItem key={et?.type ?? 'unknown'} value={et?.type ?? 'unknown'}>
                    {et?.type ?? 'Unknown'} ({et?.count ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-slate-500">{total} errors total</span>
          </div>
        </CardContent>
      </Card>

      {/* Error cards */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 })?.map?.((_: any, i: number) => (
            <Card key={i} className="bg-white/5 border-white/10">
              <CardContent className="pt-6"><div className="h-16 bg-white/5 rounded animate-pulse" /></CardContent>
            </Card>
          ))
        ) : (errors?.length ?? 0) === 0 ? (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="pt-6 text-center text-slate-500 py-12">
              <AlertCircle className="h-10 w-10 mx-auto mb-3 text-slate-600" />
              <p>No errors found</p>
            </CardContent>
          </Card>
        ) : (
          errors?.map?.((err: ErrorLog) => (
            <Card
              key={err?.id}
              className="bg-white/5 border-white/10 hover:bg-white/[0.07] cursor-pointer transition-colors"
              onClick={() => setSelectedError(err)}
            >
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">
                        {err?.errorType ?? 'Error'}
                      </Badge>
                      <span className="text-xs text-slate-500 font-mono">{formatTime(err?.receivedAt)}</span>
                    </div>
                    <p className="text-sm text-white truncate">{err?.errorMessage ?? 'Unknown error'}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      From: {err?.senderName ?? err?.senderEmail ?? 'Unknown'} | Subject: {err?.subject ?? 'N/A'} | Target: {err?.targetPerson ?? 'N/A'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {(totalPages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p: number) => Math.max(1, p - 1))} className="border-white/10 text-slate-400">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p: number) => p + 1)} className="border-white/10 text-slate-400">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail Modal */}
      {selectedError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedError(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e: any) => e?.stopPropagation?.()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-display font-bold text-white">Error Details</h3>
              <button onClick={() => setSelectedError(null)} className="text-slate-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <DetailRow label="Timestamp" value={formatTime(selectedError?.receivedAt)} />
              <DetailRow label="Error Type" value={selectedError?.errorType} />
              <DetailRow label="Error Message" value={selectedError?.errorMessage} />
              <DetailRow label="Sender" value={selectedError?.senderName ? `${selectedError.senderName} (${selectedError?.senderEmail ?? ''})` : selectedError?.senderEmail} />
              <DetailRow label="Subject" value={selectedError?.subject} />
              <DetailRow label="Target Person" value={selectedError?.targetPerson} />
              <DetailRow label="Email Message ID" value={selectedError?.emailMessageId} />
              {selectedError?.instructionsDetected && <DetailRow label="Instructions" value={selectedError.instructionsDetected} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm text-white break-all">{value ?? 'N/A'}</span>
    </div>
  );
}
