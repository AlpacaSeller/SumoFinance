"use client";

// ── Grafici (Recharts), consapevoli del tema chiaro/scuro ───────────────────

import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { fmtEUR, fmtEUR0, fmtPct } from "@/lib/format";
import { useChartTheme } from "./chartTheme";

// riesportati per compatibilità: i moduli senza grafici li importino da
// ./chartTheme per non trascinare Recharts nel bundle
export { useChartTheme, useClassColors } from "./chartTheme";

function compactEUR(v: number): string {
  if (Math.abs(v) >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(v) >= 10_000)
    return `${Math.round(v / 1000).toLocaleString("it-IT")} k€`;
  if (Math.abs(v) >= 1_000)
    return `${(v / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v).toLocaleString("it-IT")} €`;
}

// ── Andamento patrimonio (da snapshot) ──────────────────────────────────────

export function NetWorthChart({
  data,
  maxPoint,
}: {
  data: { date: string; label: string; value: number }[];
  maxPoint?: { date: string; value: number; label: string };
}) {
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.brandLine} stopOpacity={0.25} />
            <stop offset="100%" stopColor={t.brandLine} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={compactEUR}
          width={64}
        />
        <Tooltip
          contentStyle={t.tooltip}
          formatter={(v) => [fmtEUR(Number(v)), "Patrimonio netto"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={t.brandLine}
          strokeWidth={2}
          fill="url(#nw)"
          isAnimationActive={false}
        />
        {maxPoint && (
          <ReferenceDot
            x={maxPoint.label}
            y={maxPoint.value}
            r={4}
            fill={t.pos}
            stroke={t.surface}
            strokeWidth={2}
            label={{
              value: `Max ${compactEUR(maxPoint.value)}`,
              position: "top",
              fontSize: 11,
              fill: t.pos,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Donut allocazione ───────────────────────────────────────────────────────

export function AllocationDonut({
  data,
  height = 220,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
}) {
  const t = useChartTheme();
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="88%"
          paddingAngle={2}
          strokeWidth={0}
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={t.tooltip}
          formatter={(v, name) => [
            `${fmtEUR(Number(v))} (${total > 0 ? fmtPct((Number(v) / total) * 100) : "—"})`,
            String(name),
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Radar salute finanziaria ────────────────────────────────────────────────

export function HealthRadar({ data }: { data: { label: string; score: number }[] }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={t.grid} />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: t.soft }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          dataKey="score"
          stroke={t.brandLine}
          fill={t.brandLine}
          fillOpacity={0.25}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={t.tooltip}
          formatter={(v) => [`${Math.round(Number(v))}/100`, "Punteggio"]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Cash flow (barre entrate/uscite + linea risparmio) ─────────────────────

export function CashflowChart({
  data,
}: {
  data: { label: string; entrate: number; uscite: number; risparmio: number }[];
}) {
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={compactEUR}
          width={64}
        />
        <Tooltip contentStyle={t.tooltip} formatter={(v, name) => [fmtEUR(Number(v)), String(name)]} />
        <Bar dataKey="entrate" name="Entrate" fill={t.pos} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="uscite" name="Uscite" fill={t.neg} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Line
          type="monotone"
          dataKey="risparmio"
          name="Risparmio"
          stroke={t.accent}
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Bar chart mensile semplice (entrate o uscite, 12 mesi) ─────────────────

export function MonthlyBars({
  data,
  tone,
  avg,
}: {
  data: { label: string; value: number }[];
  tone: "pos" | "neg";
  avg?: number;
}) {
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={compactEUR}
          width={64}
        />
        <Tooltip contentStyle={t.tooltip} formatter={(v) => [fmtEUR(Number(v)), "Totale"]} />
        <Bar dataKey="value" fill={tone === "pos" ? t.pos : t.neg} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        {avg != null && avg > 0 && (
          <ReferenceLine
            y={avg}
            stroke={t.soft}
            strokeDasharray="4 4"
            label={{
              value: `media ${compactEUR(avg)}`,
              position: "insideTopRight",
              fontSize: 10,
              fill: t.soft,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Fan chart Monte Carlo ───────────────────────────────────────────────────

export function FanChart({
  data,
  target,
}: {
  data: {
    year: number;
    p10: number;
    p50: number;
    p90: number;
    band: [number, number];
    p50b?: number; // scenario alternativo (mediana)
  }[];
  target?: number | null;
}) {
  const hasScenarioB = data.some((d) => d.p50b != null);
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="year"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v} a`}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={compactEUR}
          width={70}
        />
        <Tooltip
          contentStyle={t.tooltip}
          labelFormatter={(v) => `Anno ${v}`}
          formatter={(v, name) => {
            if (name === "Fascia 10–90%") {
              const [lo, hi] = v as [number, number];
              return [`${fmtEUR0(lo)} – ${fmtEUR0(hi)}`, "Fascia 10–90%"];
            }
            return [fmtEUR0(Number(v)), String(name)];
          }}
        />
        <Area
          dataKey="band"
          name="Fascia 10–90%"
          stroke="none"
          fill={t.brandLine}
          fillOpacity={0.12}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="p50"
          name="Scenario mediano"
          stroke={t.brandLine}
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
        />
        {hasScenarioB && (
          <Line
            type="monotone"
            dataKey="p50b"
            name="Scenario B (mediana)"
            stroke={t.accent}
            strokeWidth={2}
            strokeDasharray="7 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="p90"
          name="Scenario ottimistico (90°)"
          stroke={t.pos}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="p10"
          name="Scenario pessimistico (10°)"
          stroke={t.neg}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
        />
        {target != null && target > 0 && (
          <ReferenceLine
            y={target}
            stroke={t.accent}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            label={{
              value: `Obiettivo FIRE ${compactEUR(target)}`,
              position: "insideBottomRight",
              fontSize: 11,
              fill: t.accent,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Treemap portafoglio ─────────────────────────────────────────────────────

interface TreemapItem {
  name: string;
  size: number;
  color: string;
  pctOfGross: number;
  pl: number;
  plPct: number | null;
  assetClass: string;
  [key: string]: unknown;
}

function TreemapCell(props: Record<string, unknown>) {
  const { x, y, width, height, name, color, cellStroke } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    color?: string;
    cellStroke?: string;
  };
  if (width <= 0 || height <= 0) return null;
  const showLabel = width > 56 && height > 24;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        fill={color || "#93a29b"}
        stroke={cellStroke || "#ffffff"}
        strokeWidth={2}
      />
      {showLabel && (
        <text
          x={x + 8}
          y={y + 18}
          fontSize={11}
          fontWeight={600}
          fill="#ffffff"
          style={{ pointerEvents: "none" }}
        >
          {String(name).slice(0, Math.max(3, Math.floor(width / 8)))}
        </text>
      )}
    </g>
  );
}

export function PortfolioTreemap({ items }: { items: TreemapItem[] }) {
  const t = useChartTheme();
  const data = items.map((i) => ({ ...i, cellStroke: t.surface }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <Treemap
        data={data}
        dataKey="size"
        nameKey="name"
        isAnimationActive={false}
        content={<TreemapCell />}
      >
        <Tooltip
          contentStyle={t.tooltip}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as TreemapItem | undefined;
            if (!p) return null;
            return (
              <div style={t.tooltip} className="px-3 py-2">
                <div className="font-semibold">{p.name}</div>
                <div className="tnum">
                  {fmtEUR(p.size)} · {fmtPct(p.pctOfGross)} del lordo
                </div>
                <div className={`tnum ${p.pl >= 0 ? "text-pos" : "text-neg"}`}>
                  P/L {fmtEUR(p.pl)}
                  {p.plPct != null ? ` (${fmtPct(p.plPct)})` : ""}
                </div>
                <div className="text-faint">{p.assetClass}</div>
              </div>
            );
          }}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

// ── Previsione liquidità (12 mesi) ──────────────────────────────────────────

export function ForecastChart({
  data,
}: {
  data: { label: string; entrate: number; uscite: number; saldo: number }[];
}) {
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={20} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={compactEUR}
          width={64}
        />
        <Tooltip
          contentStyle={t.tooltip}
          formatter={(v, name) => [fmtEUR0(Number(v)), String(name)]}
        />
        <ReferenceLine y={0} stroke={t.neg} strokeDasharray="4 4" />
        <Bar
          dataKey="entrate"
          name="Entrate previste"
          fill={t.pos}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
          opacity={0.55}
        />
        <Bar
          dataKey="uscite"
          name="Uscite previste"
          fill={t.neg}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
          opacity={0.55}
        />
        <Line
          type="monotone"
          dataKey="saldo"
          name="Saldo previsto"
          stroke={t.brandLine}
          strokeWidth={2.5}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Valore investito nel tempo (ricostruzione) ──────────────────────────────

export function PortfolioHistoryChart({
  data,
}: {
  data: { label: string; value: number; invested: number }[];
}) {
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.brandLine} stopOpacity={0.2} />
            <stop offset="100%" stopColor={t.brandLine} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={compactEUR}
          width={64}
        />
        <Tooltip
          contentStyle={t.tooltip}
          formatter={(v, name) => [fmtEUR(Number(v)), String(name)]}
        />
        <Area
          type="monotone"
          dataKey="value"
          name="Valore di mercato"
          stroke={t.brandLine}
          strokeWidth={2}
          fill="url(#pv)"
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="invested"
          name="Capitale investito"
          stroke={t.accent}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Mini grafico storico prezzo (1 anno) ────────────────────────────────────

export function PriceHistoryChart({ points }: { points: { t: number; p: number }[] }) {
  const t = useChartTheme();
  const axisTick = { fontSize: 11, fill: t.axis };
  const data = points.map((x) => ({
    label: new Date(x.t).toLocaleDateString("it-IT", { month: "short", year: "2-digit" }),
    date: new Date(x.t).toLocaleDateString("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    value: x.p,
  }));
  const positive = data.length >= 2 && data[data.length - 1].value >= data[0].value;
  const color = positive ? t.pos : t.neg;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={48} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(v) => Number(v).toLocaleString("it-IT", { maximumFractionDigits: 2 })}
          width={56}
        />
        <Tooltip
          contentStyle={t.tooltip}
          labelFormatter={(_, payload) => (payload?.[0]?.payload as { date?: string })?.date ?? ""}
          formatter={(v) => [
            Number(v).toLocaleString("it-IT", { maximumFractionDigits: 4 }),
            "Prezzo",
          ]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
