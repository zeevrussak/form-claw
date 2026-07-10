'use client';

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

const COLORS = ['#60B5FF', '#FF9149', '#FF9898', '#80D8C3', '#A19AD3', '#72BF78'];

export default function TargetPieChart({ data }: { data: any[] }) {
  const safeData = (data ?? [])?.map?.((d: any) => ({ name: d?.target ?? 'Unknown', value: d?.count ?? 0 }))?.filter?.((d: any) => (d?.value ?? 0) > 0) ?? [];

  if (safeData?.length === 0) {
    return <div className="h-full flex items-center justify-center text-slate-500 text-sm">No data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={safeData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          dataKey="value"
          label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100)?.toFixed?.(0)}%`}
          labelLine={false}
        >
          {safeData?.map?.((_: any, i: number) => (
            <Cell key={i} fill={COLORS?.[i % COLORS?.length] ?? '#60B5FF'} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 11, backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
        <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
