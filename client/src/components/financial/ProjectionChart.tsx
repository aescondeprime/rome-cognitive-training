import { Area, Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectionPoint } from "@/lib/financialEngine";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function TooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as ProjectionPoint | undefined;
  if (!point) return null;
  return (
    <div className="min-w-40 rounded-lg border border-white/10 bg-[hsl(222_20%_6%/0.96)] p-3 shadow-2xl backdrop-blur-xl">
      <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <div className="space-y-1 font-mono text-[11px]">
        <div className="flex justify-between gap-5"><span className="text-muted-foreground">Balance</span><span>{currency.format(point.balance)}</span></div>
        {point.inflow > 0 && <div className="flex justify-between gap-5"><span className="text-emerald-400/70">Income</span><span className="text-emerald-300">+{currency.format(point.inflow)}</span></div>}
        {point.outflow > 0 && <div className="flex justify-between gap-5"><span className="text-rose-400/70">Spending</span><span className="text-rose-300">−{currency.format(point.outflow)}</span></div>}
      </div>
    </div>
  );
}
export default function ProjectionChart({ data }: { data: ProjectionPoint[] }) {
  return (
    <div className="h-[330px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 14, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id="balanceField" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--accent-h) 82% 62%)" stopOpacity={0.35} />
              <stop offset="78%" stopColor="hsl(var(--accent-h) 65% 40%)" stopOpacity={0.035} />
              <stop offset="100%" stopColor="hsl(var(--accent-h) 65% 40%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="spendBars" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(354 72% 63%)" stopOpacity={0.72} />
              <stop offset="100%" stopColor="hsl(354 72% 42%)" stopOpacity={0.18} />
            </linearGradient>
            <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(214 14% 18% / 0.5)" strokeDasharray="2 7" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={36} tick={{ fill: "hsl(214 15% 42%)", fontSize: 9, fontFamily: "DM Mono" }} />
          <YAxis
            yAxisId="balance"
            tickLine={false}
            axisLine={false}
            width={58}
            tickFormatter={value => `$${Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value)}`}
            tick={{ fill: "hsl(214 15% 42%)", fontSize: 9, fontFamily: "DM Mono" }}
          />
          <YAxis yAxisId="flow" orientation="right" hide domain={[0, "dataMax * 4"]} />
          <Tooltip content={<TooltipContent />} cursor={{ stroke: "hsl(var(--accent-h) 65% 55% / 0.24)", strokeWidth: 1 }} />
          <ReferenceLine yAxisId="balance" y={0} stroke="hsl(0 64% 52% / 0.58)" strokeDasharray="4 6" />
          <Area yAxisId="balance" type="monotone" dataKey="balance" fill="url(#balanceField)" stroke="transparent" />
          <Bar yAxisId="flow" dataKey="outflow" fill="url(#spendBars)" barSize={7} radius={[4, 4, 0, 0]} />
          <Area
            yAxisId="balance"
            type="monotone"
            dataKey="balance"
            fill="transparent"
            stroke="hsl(var(--accent-h) 82% 66%)"
            strokeWidth={2.2}
            dot={false}
            activeDot={{ r: 4, fill: "hsl(var(--accent-h) 88% 70%)", stroke: "hsl(222 20% 6%)", strokeWidth: 2 }}
            style={{ filter: "url(#lineGlow)" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
