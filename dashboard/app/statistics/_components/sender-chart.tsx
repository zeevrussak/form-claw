'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

const COLORS = ['#60B5FF', '#FF9149', '#FF9898', '#FF90BB', '#80D8C3', '#A19AD3', '#72BF78', '#FF6363'];

export default function SenderChart({ data }: { data: any[] }) {
  const safeData = data ?? [];
  if (safeData?.length === 0) {
    return <div className="h-full flex items-center justify-center text-slate-500 text-sm">No data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={safeData} margin={{ top: 10, right: 20, left: 10, bottom: 45 }} layout="vertical">
        <YAxis
          type="category"
          dataKey="sender"
          tickLine={false}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          width={120}
        />
        <XAxis
          type="number"
          tickLine={false}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          label={{ value: 'Forms', position: 'insideBottom', offset: -15, style: { textAnchor: 'middle', fontSize: 11, fill: '#64748b' } }}
        />
        <Tooltip contentStyle={{ fontSize: 11, backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {safeData?.map?.((_: any, i: number) => (
            <Cell key={i} fill={COLORS?.[i % COLORS?.length] ?? '#60B5FF'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
