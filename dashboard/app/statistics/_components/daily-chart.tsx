'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

export default function DailyChart({ data }: { data: any[] }) {
  const safeData = data ?? [];
  if (safeData?.length === 0) {
    return <div className="h-full flex items-center justify-center text-slate-500 text-sm">No data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={safeData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
        <XAxis
          dataKey="date"
          tickLine={false}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          interval="preserveStartEnd"
          angle={-45}
          textAnchor="end"
          height={50}
          label={{ value: 'Date', position: 'insideBottom', offset: -15, style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' } }}
        />
        <YAxis
          tickLine={false}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          label={{ value: 'Count', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' } }}
        />
        <Tooltip contentStyle={{ fontSize: 11, backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
        <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="total" stroke="#60B5FF" strokeWidth={2} dot={false} name="Total" />
        <Line type="monotone" dataKey="success" stroke="#34d399" strokeWidth={2} dot={false} name="Success" />
        <Line type="monotone" dataKey="failure" stroke="#f87171" strokeWidth={2} dot={false} name="Failure" />
      </LineChart>
    </ResponsiveContainer>
  );
}
