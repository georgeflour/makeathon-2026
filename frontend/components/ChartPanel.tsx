"use client";

import {
  ComposedChart,
  Bar,
  Line,
  Area,
  Scatter,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ErrorBar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ScatterChart,
  FunnelChart,
  Funnel,
  LabelList,
  RadialBarChart,
  RadialBar,
} from "recharts";
import type { ChartSpec } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getPalette } from "@/lib/palettes";
import { Plus, Check, Copy, Sparkles, ArrowRight } from "lucide-react";
import { JSX, useState } from "react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBarColor(
  value: number,
  above: string,
  below: string,
  primary: string,
  colorRules?: ChartSpec["color_rules"]
): string {
  if (!colorRules) return primary;
  return value >= colorRules.threshold ? above : below;
}

function formatValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (value > 0 && value <= 1) return `${(value * 100).toFixed(value === 1 ? 0 : 1)}%`;
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function formatTooltipValue(value: number): string {
  if (value >= 1000) return value.toLocaleString();
  if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

const LABEL_ABBR: Record<string, true> = {
  otp: true, api: true, id: true, url: true, sms: true, pin: true,
  cvv: true, atm: true, iban: true, sku: true, erp: true, crm: true,
};

function formatLabel(label: unknown): string {
  if (typeof label !== "string") return String(label ?? "");
  return label
    .split("_")
    .map((word) => {
      const lower = word.toLowerCase();
      if (LABEL_ABBR[lower]) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function computeYDomain(values: number[]): [number, number] {
  const finite = values.filter(isFinite);
  if (finite.length === 0) return [0, 1];
  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
  const isLikelyRate = dataMin >= 0 && dataMax <= 1 && dataMax > 0;
  if (isLikelyRate) return [0, 1];
  const range = dataMax - dataMin;
  if (range === 0) {
    const pad = Math.abs(dataMax) * 0.1 || 1;
    return [Math.max(0, dataMax - pad), dataMax + pad];
  }
  if (dataMin <= 0 || range / dataMax >= 0.3) {
    return [Math.min(0, dataMin), dataMax + range * 0.1];
  }
  const pad = Math.max(range * 0.15, dataMax * 0.005);
  return [Math.max(0, dataMin - pad), dataMax + pad];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LabelValue { label: string; value: number }
interface GroupedRow { label: string; group: string; value: number }
interface ScatterRow { x: number; y: number; size?: number }
interface HeatmapRow { row: string; col: string; value: number }
interface BoxplotRow { label: string; min: number; q1: number; median: number; q3: number; max: number }
interface ErrorbarRow { label: string; value: number; lower: number; upper: number }
interface CandleRow { date: string; open: number; close: number; high: number; low: number }
interface SpanRow { label: string; min: number; max: number }

interface ChartProps {
  data: any;
  colors: string[];
  primary: string;
  above: string;
  below: string;
  color_rules?: ChartSpec["color_rules"];
  height?: number;
}

interface Props {
  chart: ChartSpec;
  hideSaveButton?: boolean;
  onModify?: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({ data, color_rules, primary, above, below }: ChartProps) {
  const raw = typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as { value: number }).value
    : Array.isArray(data) && data.length === 1
      ? (data[0].value ?? data[0][Object.keys(data[0])[0]])
      : (data as number);
  const value = Number(raw) || 0;
  const color = color_rules ? getBarColor(value, above, below, primary, color_rules) : primary;
  const display = value > 0 && value < 1
    ? `${(value * 100).toFixed(1)}%`
    : value.toLocaleString();
  return (
    <div className="flex items-center justify-center py-8">
      <span className="text-5xl font-extrabold" style={{ color }}>{display}</span>
    </div>
  );
}

function PieChartContainer({ data, colors, innerRadius, height }: { data: LabelValue[]; colors: string[]; innerRadius: number; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? 280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={100}
          label={({ name, percent }) => {
            const pretty = formatLabel(name);
            return `${pretty.length > 14 ? pretty.slice(0, 13) + "..." : pretty} ${((percent ?? 0) * 100).toFixed(1)}%`;
          }}
          labelLine={false}
        >
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function StackedBarChart({ data, colors, height }: ChartProps) {
  const rows = data as GroupedRow[];
  const labels = [...new Set(rows.map((d) => d.label))];
  const groups = [...new Set(rows.map((d) => d.group))];
  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = rows.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height ?? 280}>
      <ComposedChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Legend />
        {groups.map((g, i) => (
          <Bar key={`${String(g)}-${i}`} dataKey={String(g)} stackId="a" fill={colors[i % colors.length]} radius={i === groups.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function GroupedBarChart({ data, colors, height }: ChartProps) {
  const rows = data as GroupedRow[];
  const labels = [...new Set(rows.map((d) => d.label))];
  const groups = [...new Set(rows.map((d) => d.group))];
  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = rows.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height ?? 280}>
      <ComposedChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Legend />
        {groups.map((g, i) => (
          <Bar key={`${String(g)}-${i}`} dataKey={String(g)} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function StackedAreaChartView({ data, colors, height }: ChartProps) {
  const rows = data as GroupedRow[];
  const labels = [...new Set(rows.map((d) => d.label))];
  const groups = [...new Set(rows.map((d) => d.group))];
  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = rows.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height ?? 260}>
      <ComposedChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
        <defs>
          {groups.map((g, i) => (
            <linearGradient key={`grad-${String(g)}-${i}`} id={`areaG_${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.4} />
              <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Legend />
        {groups.map((g, i) => (
          <Area key={`${String(g)}-${i}`} type="monotone" dataKey={String(g)} stackId="a" stroke={colors[i % colors.length]} fill={`url(#areaG_${i})`} fillOpacity={1} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function RadarChartView({ data, primary, height }: ChartProps) {
  const rows = data as LabelValue[];
  const isRate = rows.length > 0 && rows.every((d) => d.value >= 0 && d.value <= 1);
  return (
    <ResponsiveContainer width="100%" height={height ?? 300}>
      <RadarChart data={rows} margin={{ top: 8, right: 32, left: 32, bottom: 8 }}>
        <PolarGrid stroke="hsl(var(--border))" />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={formatLabel} />
        <PolarRadiusAxis
          angle={90}
          domain={isRate ? [0, 1] : [0, "auto"]}
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={formatValue}
          tickCount={4}
        />
        <Radar dataKey="value" stroke={primary} fill={primary} fillOpacity={0.25} strokeWidth={2} />
        <Tooltip formatter={(v) => formatTooltipValue(Number(v))} labelFormatter={formatLabel} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function ScatterView({ data, primary, height }: ChartProps) {
  const rows: ScatterRow[] = Array.isArray(data)
    ? (data as any[]).map((d) => ({ x: Number(d.x ?? 0), y: Number(d.y ?? 0) }))
    : [];
  return (
    <ResponsiveContainer width="100%" height={height ?? 260}>
      <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="x" type="number" name="x" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <YAxis dataKey="y" type="number" name="y" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => formatValue(Number(v))} />
        <Scatter data={rows} fill={primary} opacity={0.75} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function BubbleView({ data, primary, height }: ChartProps) {
  const rows: ScatterRow[] = Array.isArray(data)
    ? (data as any[]).map((d) => ({ x: Number(d.x ?? 0), y: Number(d.y ?? 0), size: Number(d.size ?? 10) }))
    : [];
  return (
    <ResponsiveContainer width="100%" height={height ?? 280}>
      <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="x" type="number" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <YAxis dataKey="y" type="number" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <ZAxis dataKey="size" range={[40, 800]} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => formatValue(Number(v))} />
        <Scatter data={rows} fill={primary} opacity={0.65} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function HeatmapChart({ data, primary, height }: ChartProps) {
  const rows_data = data as HeatmapRow[];
  if (!rows_data.length) return null;
  const rows = [...new Set(rows_data.map((d) => d.row))];
  const cols = [...new Set(rows_data.map((d) => d.col))];
  const values = rows_data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const CELL_W = Math.max(36, Math.min(80, Math.floor(520 / cols.length)));
  const CELL_H = 32;
  const LEFT_PAD = 120; const TOP_PAD = 40;
  const svgW = LEFT_PAD + cols.length * CELL_W + 8;
  const svgH = height ?? (TOP_PAD + rows.length * CELL_H + 8);
  const opacity = (v: number) => max === min ? 0.7 : 0.1 + 0.85 * ((v - min) / (max - min));
  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} style={{ display: "block" }}>
        {cols.map((col, ci) => (
          <text key={`col-${ci}`} x={LEFT_PAD + ci * CELL_W + CELL_W / 2} y={TOP_PAD - 6} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
            {String(col).length > 8 ? String(col).slice(0, 7) + "..." : col}
          </text>
        ))}
        {rows.map((row, ri) => (
          <g key={`row-${ri}`}>
            <text x={LEFT_PAD - 6} y={TOP_PAD + ri * CELL_H + CELL_H / 2} textAnchor="end" dominantBaseline="central" fontSize={10} fill="hsl(var(--muted-foreground))">
              {String(row).length > 14 ? String(row).slice(0, 13) + "..." : row}
            </text>
            {cols.map((col, ci) => {
              const cell = rows_data.find((d) => d.row === row && d.col === col);
              const v = cell?.value ?? 0;
              return (
                <g key={`cell-${ri}-${ci}`}>
                  <rect x={LEFT_PAD + ci * CELL_W} y={TOP_PAD + ri * CELL_H} width={CELL_W - 2} height={CELL_H - 2} rx={3} fill={primary} fillOpacity={opacity(v)} stroke="hsl(var(--border))" strokeWidth={0.5} />
                  <text x={LEFT_PAD + ci * CELL_W + CELL_W / 2} y={TOP_PAD + ri * CELL_H + CELL_H / 2} textAnchor="middle" dominantBaseline="central" fontSize={9} fill={opacity(v) > 0.5 ? "#fff" : "hsl(var(--foreground))"}>
                    {formatValue(v)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

function BoxplotChart({ data, colors, height }: ChartProps) {
  const rows = data as BoxplotRow[];
  if (!rows.length) return null;
  const allVals = rows.flatMap((d) => [d.min, d.max]);
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);
  const range = globalMax - globalMin || 1;
  const HEIGHT = height ?? 220; const PAD_TOP = 20; const PAD_BOTTOM = 50;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const toY = (v: number) => PAD_TOP + plotH - ((v - globalMin) / range) * plotH;
  const itemW = Math.max(40, Math.min(90, Math.floor(540 / rows.length)));
  const svgW = 60 + rows.length * itemW;
  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={HEIGHT} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, ti) => {
          const yy = PAD_TOP + plotH * (1 - t);
          return (
            <g key={`guide-${ti}`}>
              <line x1={50} y1={yy} x2={svgW} y2={yy} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={46} y={yy} textAnchor="end" dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">{formatValue(globalMin + range * t)}</text>
            </g>
          );
        })}
        {rows.map((d, i) => {
          const cx = 60 + i * itemW + itemW / 2;
          const color = colors[i % colors.length];
          const bw = Math.min(itemW * 0.55, 40);
          return (
            <g key={`box-${i}`}>
              <line x1={cx} y1={toY(d.min)} x2={cx} y2={toY(d.q1)} stroke={color} strokeWidth={1.5} />
              <line x1={cx} y1={toY(d.q3)} x2={cx} y2={toY(d.max)} stroke={color} strokeWidth={1.5} />
              <line x1={cx - bw / 2} y1={toY(d.min)} x2={cx + bw / 2} y2={toY(d.min)} stroke={color} strokeWidth={1.5} />
              <line x1={cx - bw / 2} y1={toY(d.max)} x2={cx + bw / 2} y2={toY(d.max)} stroke={color} strokeWidth={1.5} />
              <rect x={cx - bw / 2} y={toY(d.q3)} width={bw} height={Math.max(2, toY(d.q1) - toY(d.q3))} rx={3} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} />
              <line x1={cx - bw / 2} y1={toY(d.median)} x2={cx + bw / 2} y2={toY(d.median)} stroke={color} strokeWidth={2.5} />
              <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">{String(d.label).length > 8 ? String(d.label).slice(0, 7) + "..." : d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ErrorBarChartView({ data, primary, height }: ChartProps) {
  const rows = (data as ErrorbarRow[]).map((d) => ({
    label: d.label,
    value: d.value,
    errorY: [d.value - d.lower, d.upper - d.value] as [number, number],
  }));
  return (
    <ResponsiveContainer width="100%" height={height ?? 260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Bar dataKey="value" fill={primary} fillOpacity={0.7} radius={[3, 3, 0, 0]}>
          <ErrorBar dataKey="errorY" width={4} strokeWidth={2} stroke={primary} direction="y" />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function CandlestickChart({ data, above, below, height }: ChartProps) {
  const rows = data as CandleRow[];
  if (!rows.length) return null;
  const allVals = rows.flatMap((d) => [d.low, d.high]);
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);
  const range = globalMax - globalMin || 1;
  const HEIGHT = height ?? 240; const PAD_TOP = 16; const PAD_BOTTOM = 44;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const toY = (v: number) => PAD_TOP + plotH - ((v - globalMin) / range) * plotH;
  const itemW = Math.max(20, Math.min(60, Math.floor(560 / rows.length)));
  const svgW = 60 + rows.length * itemW;
  const bw = Math.max(6, itemW * 0.5);
  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={HEIGHT} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, ti) => {
          const yy = PAD_TOP + plotH * (1 - t);
          return (
            <g key={`guide-${ti}`}>
              <line x1={55} y1={yy} x2={svgW} y2={yy} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={50} y={yy} textAnchor="end" dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">{formatValue(globalMin + range * t)}</text>
            </g>
          );
        })}
        {rows.map((d, i) => {
          const cx = 60 + i * itemW + itemW / 2;
          const bullish = d.close >= d.open;
          const color = bullish ? above : below;
          const bodyTop = toY(Math.max(d.open, d.close));
          const bodyBot = toY(Math.min(d.open, d.close));
          return (
            <g key={`candle-${i}`}>
              <line x1={cx} y1={toY(d.high)} x2={cx} y2={toY(d.low)} stroke={color} strokeWidth={1.5} />
              <rect x={cx - bw / 2} y={bodyTop} width={bw} height={Math.max(2, bodyBot - bodyTop)} rx={1} fill={color} fillOpacity={bullish ? 0.85 : 0.7} stroke={color} strokeWidth={1} />
              <text x={cx} y={HEIGHT - 6} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">{String(d.date).slice(-5)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SpanChart({ data, colors, height }: ChartProps) {
  const rows = data as SpanRow[];
  if (!rows.length) return null;
  const allVals = rows.flatMap((d) => [d.min, d.max]);
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);
  const range = globalMax - globalMin || 1;
  const BAR_H = 22; const GAP = 8; const LEFT_PAD = 130; const RIGHT_PAD = 60;
  const TOP_PAD = 24; const PLOT_W = 400;
  const svgW = LEFT_PAD + PLOT_W + RIGHT_PAD;
  const svgH = height ?? (TOP_PAD + rows.length * (BAR_H + GAP) + 8);
  const toX = (v: number) => LEFT_PAD + ((v - globalMin) / range) * PLOT_W;
  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, ti) => {
          const xx = LEFT_PAD + t * PLOT_W;
          return (
            <g key={`tick-${ti}`}>
              <line x1={xx} y1={TOP_PAD - 4} x2={xx} y2={svgH - 8} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={xx} y={TOP_PAD - 7} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">{formatValue(globalMin + range * t)}</text>
            </g>
          );
        })}
        {rows.map((d, i) => {
          const y = TOP_PAD + i * (BAR_H + GAP);
          const color = colors[i % colors.length];
          return (
            <g key={`span-${i}`}>
              <text x={LEFT_PAD - 6} y={y + BAR_H / 2} textAnchor="end" dominantBaseline="central" fontSize={10} fill="hsl(var(--muted-foreground))">{String(d.label).length > 16 ? String(d.label).slice(0, 15) + "..." : d.label}</text>
              <rect x={toX(d.min)} y={y} width={Math.max(3, toX(d.max) - toX(d.min))} height={BAR_H} rx={4} fill={color} fillOpacity={0.75} />
              <text x={toX(d.max) + 4} y={y + BAR_H / 2} dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">{formatValue(d.max)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TickChart({ data, colors, height }: ChartProps) {
  const rows = data as LabelValue[];
  const vals = rows.map((d) => d.value);
  const minV = Math.min(...vals); const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const HEIGHT = height ?? 100; const LEFT_PAD = 8; const W = 560;
  const toX = (v: number) => LEFT_PAD + ((v - minV) / range) * W;
  return (
    <div className="overflow-x-auto">
      <svg width={LEFT_PAD + W + 60} height={HEIGHT + 40} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, ti) => {
          const xx = LEFT_PAD + t * W;
          return (
            <g key={`tick-${ti}`}>
              <line x1={xx} y1={20} x2={xx} y2={HEIGHT + 8} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={xx} y={14} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">{formatValue(minV + range * t)}</text>
            </g>
          );
        })}
        {rows.map((d, i) => (
          <g key={`dot-${i}`}>
            <circle cx={toX(d.value)} cy={HEIGHT / 2 + ((i % 5) - 2) * 6} r={5} fill={colors[i % colors.length]} fillOpacity={0.75} stroke="hsl(var(--background))" strokeWidth={1} />
            <title>{`${d.label}: ${formatValue(d.value)}`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

function WordCloud({ data, colors, height }: ChartProps) {
  const rows = data as LabelValue[];
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, 40);
  const maxVal = sorted[0]?.value || 1;
  return (
    <div className="flex flex-wrap gap-2 justify-center items-center py-4 px-2">
      {sorted.map((d, i) => {
        const size = 12 + Math.round((d.value / maxVal) * 22);
        return (
          <span key={i} style={{ fontSize: size, color: colors[i % colors.length], fontWeight: d.value / maxVal > 0.6 ? 700 : d.value / maxVal > 0.3 ? 500 : 400, opacity: 0.75 + 0.25 * (d.value / maxVal) }} title={`${d.label}: ${d.value}`}>
            {d.label}
          </span>
        );
      })}
    </div>
  );
}

function FunnelChartView({ data, colors, height }: ChartProps) {
  const rows = (data as LabelValue[]).map((d, i) => ({ ...d, fill: colors[i % colors.length] }));
  return (
    <ResponsiveContainer width="100%" height={height ?? 300}>
      <FunnelChart>
        <Tooltip formatter={(v) => formatValue(Number(v))} />
        <Funnel dataKey="value" data={rows} isAnimationActive>
          <LabelList position="center" fill="#fff" fontSize={11} />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

function RadialBarChartContainer({ data, colors, height }: { data: LabelValue[]; colors: string[]; height?: number }) {
  const formatted = data.map((d, i) => ({
    name: formatLabel(d.label),
    value: d.value,
    fill: colors[i % colors.length],
  }));

  return (
    <ResponsiveContainer width="100%" height={height ?? 280}>
      <RadialBarChart 
        cx="50%" 
        cy="50%" 
        innerRadius="20%" 
        outerRadius="90%" 
        barSize={10} 
        data={formatted}
      >
        <RadialBar
          label={{ position: 'insideStart', fill: '#fff', fontSize: 10 }}
          background
          dataKey="value"
        />
        <Legend iconSize={10} layout="vertical" verticalAlign="middle" align="right" />
        <Tooltip formatter={(v) => formatValue(Number(v))} />
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

function StreamChartView({ data, colors, height }: ChartProps) {
  const rows = data as GroupedRow[];
  const labels = [...new Set(rows.map((d) => d.label))];
  const groups = [...new Set(rows.map((d) => d.group))];
  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = rows.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height ?? 260}>
      <ComposedChart data={pivoted} stackOffset="silhouette" margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
        <defs>
          {groups.map((g, i) => (
            <linearGradient key={`grad-stream-${String(g)}-${i}`} id={`streamG_${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.65} />
              <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Legend />
        {groups.map((g, i) => (
          <Area key={`${String(g)}-${i}`} type="monotone" dataKey={String(g)} stackId="a" stroke={colors[i % colors.length]} fill={`url(#streamG_${i})`} fillOpacity={1} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function ViolinChartView({ data, colors, primary, height }: ChartProps) {
  const rows = data as LabelValue[];
  return (
    <ResponsiveContainer width="100%" height={height ?? 260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 16, bottom: 20 }}>
        <defs>
          <linearGradient id="violinGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={primary} stopOpacity={0.6} />
            <stop offset="95%" stopColor={primary} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Area type="monotone" dataKey="value" stroke={primary} fill="url(#violinGrad)" strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function DensityChartView({ data, primary, height }: ChartProps) {
  const rows = data as LabelValue[];
  return (
    <ResponsiveContainer width="100%" height={height ?? 260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 16, bottom: 20 }}>
        <defs>
          <linearGradient id="densityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={primary} stopOpacity={0.5} />
            <stop offset="95%" stopColor={primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Area type="monotone" dataKey="value" stroke={primary} fill="url(#densityGrad)" strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Chart Registry
// ---------------------------------------------------------------------------

type RegistryFn = (props: ChartProps) => JSX.Element | null;

const CHART_REGISTRY: Record<string, RegistryFn> = {
  kpi: (p) => <KpiCard {...p} />,
  pie: (p) => <PieChartContainer data={p.data} colors={p.colors} innerRadius={0} height={p.height} />,
  donut: (p) => <PieChartContainer data={p.data} colors={p.colors} innerRadius={60} height={p.height} />,
  arc: (p) => <PieChartContainer data={p.data} colors={p.colors} innerRadius={60} height={p.height} />,
  sunburst: (p) => <PieChartContainer data={p.data} colors={p.colors} innerRadius={30} height={p.height} />,
  radial: (p) => <RadialBarChartContainer data={p.data} colors={p.colors} height={p.height} />,
  nightingale: (p) => <PieChartContainer data={p.data} colors={p.colors} innerRadius={0} height={p.height} />,
  stacked_bar: (p) => <StackedBarChart {...p} />,
  grouped_bar: (p) => <GroupedBarChart {...p} />,
  stacked_area: (p) => <StackedAreaChartView {...p} />,
  stream: (p) => <StreamChartView {...p} />,
  radar: (p) => <RadarChartView {...p} />,
  scatter: (p) => <ScatterView {...p} />,
  bubble: (p) => <BubbleView {...p} />,
  heatmap: (p) => <HeatmapChart {...p} />,
  boxplot: (p) => <BoxplotChart {...p} />,
  errorbar: (p) => <ErrorBarChartView {...p} />,
  candlestick: (p) => <CandlestickChart {...p} />,
  span: (p) => <SpanChart {...p} />,
  tick: (p) => <TickChart {...p} />,
  wordcloud: (p) => <WordCloud {...p} />,
  funnel: (p) => <FunnelChartView {...p} />,
  // aliases
  calendar: (p) => <HeatmapChart {...p} />,
  rect: (p) => <HeatmapChart {...p} />,
  timetable: (p) => <HeatmapChart {...p} />,
  ohlc: (p) => <CandlestickChart {...p} />,
  rule_bar: (p) => <CandlestickChart {...p} />,
  range_bar: (p) => <SpanChart {...p} />,
  tally: (p) => <TickChart {...p} />,
  text: (p) => <WordCloud {...p} />,
  multiset_bar: (p) => <GroupedBarChart {...p} />,
  spiral: (p) => <RadialBarChartContainer data={p.data} colors={p.colors} height={p.height} />,
  violin: (p) => <ViolinChartView {...p} />,
  density: (p) => <DensityChartView {...p} />,
};

// Cartesian types handled by the unified ComposedChart block
const CARTESIAN_TYPES = new Set(["bar", "line", "area", "histogram"]);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ChartPanel({ chart, hideSaveButton = false, onModify }: Props) {
  const { type, title, data, color_rules, sql, explanation } = chart;
  const { profile, updateSettings } = useAuth();
  const palette = getPalette(profile?.settings?.color_palette);
  const { colors, primary, above, below } = palette;

  const [isSaving, setIsSaving] = useState(false);
  const [isSavedLocal, setIsSavedLocal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [modifyText, setModifyText] = useState("");
  const [sizeMode, setSizeMode] = useState<"sm" | "md" | "lg" | "auto">("auto");

  const savedWidgets = profile?.settings?.saved_widgets || [];
  const alreadySaved = savedWidgets.some((w) => w.chart.sql === sql) || isSavedLocal;

  const handleSaveWidget = async () => {
    if (isSaving || alreadySaved || !profile) return;
    setIsSaving(true);
    const newWidget = { id: crypto.randomUUID(), name: title || "New Widget", chart };
    await updateSettings({ saved_widgets: [newWidget, ...(profile.settings?.saved_widgets || [])] });
    setIsSaving(false);
    setIsSavedLocal(true);
  };

  const handleCopySql = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleModifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modifyText.trim() || !onModify) return;
    onModify(modifyText);
    setModifyText("");
    setShowModify(false);
  };

  const ct = type?.toLowerCase().trim() ?? "bar";

  const getChartHeight = () => {
    if (sizeMode === "sm") return 200;
    if (sizeMode === "md") return 280;
    if (sizeMode === "lg") return 400;

    // 'auto' mode
    if (ct === "kpi") return 120;
    if (!Array.isArray(data)) return 280;
    const len = data.length;
    if (len > 15) return 380;
    if (len > 8) return 320;
    return 280;
  };

  const chartProps: ChartProps = { data, colors, primary, above, below, color_rules, height: getChartHeight() };

  const renderChart = () => {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return ct !== "kpi" ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground italic">No data to display.</div>
      ) : null;
    }

    // Unified Cartesian block — bar, line, area, histogram
    if (CARTESIAN_TYPES.has(ct) && Array.isArray(data)) {
      const rows = data as LabelValue[];
      const isHistogram = ct === "histogram";
      const isLine = ct === "line";
      const isArea = ct === "area";
      const domain = computeYDomain(rows.map((d) => d.value));

      return (
        <ResponsiveContainer width="100%" height={getChartHeight()}>
          <ComposedChart data={rows} margin={{ top: 4, right: 16, left: 8, bottom: 60 }} barCategoryGap={isHistogram ? "2%" : undefined}>
            {isArea && (
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={primary} stopOpacity={0} />
                </linearGradient>
              </defs>
            )}
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" height={64} tickFormatter={formatLabel} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} width={56} domain={domain} />
            <Tooltip formatter={(v) => formatTooltipValue(Number(v))} labelFormatter={formatLabel} />
            {(ct === "bar" || isHistogram) && (
              <Bar dataKey="value" radius={isHistogram ? [2, 2, 0, 0] : [3, 3, 0, 0]} fill={primary}>
                {!isHistogram && rows.map((entry, i) => (
                  <Cell key={i} fill={getBarColor(entry.value, above, below, colors[i % colors.length], color_rules)} />
                ))}
              </Bar>
            )}
            {isLine && <Line type="monotone" dataKey="value" stroke={primary} dot={false} strokeWidth={2} />}
            {isArea && <Area type="monotone" dataKey="value" stroke={primary} fill="url(#areaGrad)" strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    // Registry lookup for all other chart types
    const Component = CHART_REGISTRY[ct];
    if (Component) return <Component {...chartProps} />;

    // Unknown type
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground italic">
        Unknown chart type: {ct}
      </div>
    );
  };

  return (
    <div className="w-full rounded-xl border bg-card shadow-sm overflow-hidden mt-2">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          {explanation && <p className="text-xs text-muted-foreground mt-0.5">{explanation}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* Sizing Toggles */}
          <div className="flex items-center rounded-md border bg-background/50 p-0.5 text-[10px] text-muted-foreground mr-1">
            {(["sm", "md", "lg", "auto"] as const).map((sz) => (
              <button key={sz} onClick={() => setSizeMode(sz)}
                title={`Scale chart to ${sz.toUpperCase()} size`}
                className={`px-1.5 py-0.5 rounded-sm font-semibold transition-colors uppercase ${sizeMode === sz ? "bg-muted text-foreground" : "hover:text-foreground"}`}>
                {sz}
              </button>
            ))}
          </div>
          {onModify && (
            <button onClick={() => setShowModify(!showModify)} title="Modify chart"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${showModify ? "bg-muted text-foreground border-border" : "border-transparent bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <Sparkles className="h-3 w-3" />Modify
            </button>
          )}
          {!hideSaveButton && (
            <button onClick={handleSaveWidget} disabled={isSaving || alreadySaved}
              title={alreadySaved ? "Already saved to dashboard" : "Save to dashboard"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {alreadySaved ? <Check className="h-3 w-3 text-emerald-500" /> : <Plus className="h-3 w-3" />}
              {alreadySaved ? "Saved" : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="px-2 pb-4">{renderChart()}</div>

      {/* Threshold legend */}
      {color_rules && (
        <div className="px-4 pb-3 flex items-center gap-4 text-xs text-muted-foreground border-t pt-2">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: above }} />
            Above {(color_rules.threshold * 100).toFixed(0)}% threshold
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: below }} />
            Needs attention
          </span>
        </div>
      )}

      {/* Modify Panel */}
      {showModify && onModify && (
        <div className="px-4 pb-4 pt-3 bg-muted/30 border-t flex flex-col gap-3">
          {chart.suggestions && chart.suggestions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {chart.suggestions.map((suggestion, idx) => (
                <button key={idx} onClick={() => { onModify?.(suggestion); setShowModify(false); }}
                  className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors">
                  {suggestion}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[["Last 7 days", "Show for the last 7 days"], ["Last 30 days", "Show for the last 30 days"], ["By segment", "Break this down by customer segment"], ["Pie chart", "Change this to a pie chart"]].map(([label, prompt]) => (
                <button key={label} onClick={() => { onModify?.(prompt); setShowModify(false); }}
                  className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors">{label}</button>
              ))}
            </div>
          )}
          <form onSubmit={handleModifySubmit} className="flex gap-2">
            <input type="text" placeholder="Make active changes to this chart..." value={modifyText}
              onChange={(e) => setModifyText(e.target.value)}
              className="flex-1 text-xs bg-background border border-border text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60" />
            <button type="submit" disabled={!modifyText.trim()}
              className="flex items-center justify-center bg-primary text-primary-foreground px-3 py-1.5 rounded-md disabled:opacity-50 transition-opacity">
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* SQL expander */}
      <details className="px-4 pb-3 group/sql">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span>View SQL</span>
            <span className="text-[10px] opacity-50 group-open/sql:rotate-180 transition-transform">v</span>
          </div>
          <button onClick={handleCopySql} className="p-1 hover:bg-muted rounded transition-colors" title="Copy SQL">
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </summary>
        <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{sql}</pre>
      </details>
    </div>
  );
}