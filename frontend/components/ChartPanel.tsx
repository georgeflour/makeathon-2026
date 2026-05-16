"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
  ComposedChart,
  ErrorBar,
} from "recharts";
import type { ChartSpec } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getPalette } from "@/lib/palettes";
import { Plus, Check, Copy, Sparkles, ArrowRight } from "lucide-react";
import { useState } from "react";

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
  if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function formatTooltipValue(value: number): string {
  if (value >= 1000) return value.toLocaleString();
  if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

const LABEL_ABBR = new Set(["otp", "api", "id", "url", "sms", "pin", "cvv", "atm", "iban", "sku", "erp", "crm"]);

function formatLabel(label: unknown): string {
  if (typeof label !== "string") return String(label ?? "");
  return label
    .split("_")
    .map((word) => {
      const lower = word.toLowerCase();
      if (LABEL_ABBR.has(lower)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function computeYDomain(values: number[]): [number, number] {
  const finite = values.filter(isFinite);
  if (finite.length === 0) return [0, 1];

  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
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
interface ScatterRow  { x: number; y: number; size?: number }
interface HeatmapRow  { row: string; col: string; value: number }
interface BoxplotRow  { label: string; min: number; q1: number; median: number; q3: number; max: number }
interface ErrorbarRow { label: string; value: number; lower: number; upper: number }
interface CandleRow   { date: string; open: number; close: number; high: number; low: number }
interface SpanRow     { label: string; min: number; max: number }

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  chart: ChartSpec;
  hideSaveButton?: boolean;
  onModify?: (prompt: string) => void;
}

// ---------------------------------------------------------------------------
// Component
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

  const savedWidgets = profile?.settings?.saved_widgets || [];
  const alreadySaved = savedWidgets.some((w) => w.chart.sql === sql) || isSavedLocal;

  const handleSaveWidget = async () => {
    if (isSaving || alreadySaved || !profile) return;
    setIsSaving(true);
    const newWidget = { id: crypto.randomUUID(), name: title || "New Widget", chart };
    const currentWidgets = profile.settings?.saved_widgets || [];
    await updateSettings({ saved_widgets: [newWidget, ...currentWidgets] });
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

  const scatterData: ScatterRow[] = Array.isArray(data)
    ? (data as any[]).map((d) => ({
        x: Number(d.x ?? d.label ?? 0),
        y: Number(d.y ?? d.value ?? 0),
        size: typeof d.size === "number" ? d.size : undefined,
      }))
    : [];

  return (
    <div className="w-full rounded-xl border bg-card shadow-sm overflow-hidden mt-2">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          {explanation && (
            <p className="text-xs text-muted-foreground mt-0.5">{explanation}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onModify && (
            <button
              onClick={() => setShowModify(!showModify)}
              title="Modify chart"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${showModify ? "bg-muted text-foreground border-border" : "border-transparent bg-background text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Sparkles className="h-3 w-3" />
              Modify
            </button>
          )}
          {!hideSaveButton && (
            <button
              onClick={handleSaveWidget}
              disabled={isSaving || alreadySaved}
              title={alreadySaved ? "Already saved to dashboard" : "Save to dashboard"}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {alreadySaved ? <Check className="h-3 w-3 text-emerald-500" /> : <Plus className="h-3 w-3" />}
              {alreadySaved ? "Saved" : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="px-2 pb-4">
        {/* ── KPI ─────────────────────────────────────────────────────── */}
        {ct === "kpi" && !Array.isArray(data) && (
          <KpiCard
            value={typeof data === "object" && data !== null ? (data as { value: number }).value : (data as number)}
            colorRules={color_rules}
            primary={primary}
            above={above}
            below={below}
          />
        )}

        {/* ── BAR ─────────────────────────────────────────────────────── */}
        {ct === "bar" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data as LabelValue[]} margin={{ top: 4, right: 16, left: 8, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" height={64} tickFormatter={formatLabel} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={formatValue}
                width={56}
                domain={computeYDomain((data as LabelValue[]).map((d) => d.value))}
              />
              <Tooltip formatter={(v) => formatTooltipValue(Number(v))} labelFormatter={formatLabel} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {(data as LabelValue[]).map((entry, i) => (
                  <Cell key={i} fill={getBarColor(entry.value, above, below, colors[i % colors.length], color_rules)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* ── LINE ────────────────────────────────────────────────────── */}
        {ct === "line" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data as LabelValue[]} margin={{ top: 4, right: 16, left: 8, bottom: 48 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" height={56} tickFormatter={formatLabel} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={formatValue}
                width={56}
                domain={computeYDomain((data as LabelValue[]).map((d) => d.value))}
              />
              <Tooltip formatter={(v) => formatTooltipValue(Number(v))} labelFormatter={formatLabel} />
              <Line type="monotone" dataKey="value" stroke={primary} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* ── AREA ────────────────────────────────────────────────────── */}
        {(ct === "area" || ct === "density") && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data as LabelValue[]} margin={{ top: 4, right: 16, left: 8, bottom: 48 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" height={56} tickFormatter={formatLabel} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={formatValue}
                width={56}
                domain={computeYDomain((data as LabelValue[]).map((d) => d.value))}
              />
              <Tooltip formatter={(v) => formatTooltipValue(Number(v))} labelFormatter={formatLabel} />
              <Area type="monotone" dataKey="value" stroke={primary} fill="url(#areaGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* ── PIE / DONUT / ARC / RADIAL / SUNBURST / NIGHTINGALE ────── */}
        {["pie", "donut", "arc", "radial", "sunburst", "nightingale"].includes(ct) && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data as LabelValue[]}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={ct === "donut" || ct === "arc" ? 60 : 0}
                outerRadius={90}
                label={({ name, percent }) => {
                  const pretty = formatLabel(name);
                  return `${pretty.length > 14 ? pretty.slice(0, 13) + "…" : pretty} ${((percent ?? 0) * 100).toFixed(1)}%`;
                }}
                labelLine={false}
              >
                {(data as LabelValue[]).map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}

        {/* ── STACKED BAR ─────────────────────────────────────────────── */}
        {(ct === "stacked_bar" || ct === "multiset_bar") && Array.isArray(data) && (
          <StackedBarChart data={data as GroupedRow[]} colors={colors} formatValue={formatValue} />
        )}

        {/* ── GROUPED BAR ─────────────────────────────────────────────── */}
        {ct === "grouped_bar" && Array.isArray(data) && (
          <GroupedBarChart data={data as GroupedRow[]} colors={colors} formatValue={formatValue} />
        )}

        {/* ── STACKED AREA ────────────────────────────────────────────── */}
        {ct === "stacked_area" && Array.isArray(data) && (
          <StackedAreaChartView data={data as GroupedRow[]} colors={colors} primary={primary} formatValue={formatValue} />
        )}

        {/* ── SCATTER ─────────────────────────────────────────────────── */}
        {ct === "scatter" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" type="number" name="x" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <YAxis dataKey="y" type="number" name="y" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => formatValue(Number(v))} />
              <Scatter data={scatterData} fill={primary} opacity={0.75} />
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {/* ── BUBBLE ──────────────────────────────────────────────────── */}
        {ct === "bubble" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" type="number" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <YAxis dataKey="y" type="number" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <ZAxis dataKey="size" range={[40, 800]} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => formatValue(Number(v))} />
              <Scatter data={scatterData} fill={primary} opacity={0.65} />
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {/* ── HEATMAP ─────────────────────────────────────────────────── */}
        {(ct === "heatmap" || ct === "rect" || ct === "calendar") && Array.isArray(data) && (
          <HeatmapChart data={data as HeatmapRow[]} primary={primary} />
        )}

        {/* ── BOXPLOT ─────────────────────────────────────────────────── */}
        {ct === "boxplot" && Array.isArray(data) && (
          <BoxplotChart data={data as BoxplotRow[]} primary={primary} colors={colors} />
        )}

        {/* ── ERROR BAR ───────────────────────────────────────────────── */}
        {ct === "errorbar" && Array.isArray(data) && (
          <ErrorBarChart data={data as ErrorbarRow[]} primary={primary} formatValue={formatValue} />
        )}

        {/* ── CANDLESTICK / OHLC ──────────────────────────────────────── */}
        {(ct === "candlestick" || ct === "rule_bar" || ct === "ohlc") && Array.isArray(data) && (
          <CandlestickChart data={data as CandleRow[]} above={above} below={below} />
        )}

        {/* ── SPAN / RANGE BAR ────────────────────────────────────────── */}
        {(ct === "span" || ct === "range_bar") && Array.isArray(data) && (
          <SpanChart data={data as SpanRow[]} primary={primary} colors={colors} formatValue={formatValue} />
        )}

        {/* ── TICK / TALLY ────────────────────────────────────────────── */}
        {(ct === "tick" || ct === "tally") && Array.isArray(data) && (
          <TickChart data={data as LabelValue[]} primary={primary} colors={colors} formatValue={formatValue} />
        )}

        {/* ── TEXT / WORDCLOUD ────────────────────────────────────────── */}
        {(ct === "text" || ct === "wordcloud") && Array.isArray(data) && (
          <WordCloud data={data as LabelValue[]} colors={colors} />
        )}

        {/* ── HISTOGRAM (same shape as bar, x-axis is numeric bins) ───── */}
        {ct === "histogram" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data as LabelValue[]} barCategoryGap="2%" margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickFormatter={formatLabel} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
              <Bar dataKey="value" fill={primary} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* ── SPIRAL / VIOLIN / UNKNOWN → fallback bar ────────────────── */}
        {["spiral", "violin"].includes(ct) && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data as LabelValue[]} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickFormatter={formatLabel} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {(data as LabelValue[]).map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* ── No data ─────────────────────────────────────────────────── */}
        {(!data || (Array.isArray(data) && data.length === 0)) && ct !== "kpi" && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground italic">
            No data to display.
          </div>
        )}
      </div>

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
                <button 
                  key={idx} 
                  onClick={() => { onModify?.(suggestion); setShowModify(false); }} 
                  className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { onModify?.("Show for the last 7 days"); setShowModify(false); }} className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors">Last 7 days</button>
              <button onClick={() => { onModify?.("Show for the last 30 days"); setShowModify(false); }} className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors">Last 30 days</button>
              <button onClick={() => { onModify?.("Break this down by customer segment"); setShowModify(false); }} className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors">By segment</button>
              <button onClick={() => { onModify?.("Change this to a pie chart"); setShowModify(false); }} className="text-[10px] px-2 py-1 rounded-md bg-background border hover:bg-muted text-muted-foreground transition-colors">Pie chart</button>
            </div>
          )}
          <form onSubmit={handleModifySubmit} className="flex gap-2">
            <input 
              type="text" 
              placeholder="Make active changes to this chart..." 
              value={modifyText}
              onChange={(e) => setModifyText(e.target.value)}
              className="flex-1 text-xs bg-background border border-border text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60"
            />
            <button type="submit" disabled={!modifyText.trim()} className="flex items-center justify-center bg-primary text-primary-foreground px-3 py-1.5 rounded-md disabled:opacity-50 transition-opacity">
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
            <span className="text-[10px] opacity-50 group-open/sql:rotate-180 transition-transform">▾</span>
          </div>
          <button
            onClick={handleCopySql}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Copy SQL"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </summary>
        <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {sql}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  value,
  colorRules,
  primary,
  above,
  below,
}: {
  value: number;
  colorRules?: ChartSpec["color_rules"];
  primary: string;
  above: string;
  below: string;
}) {
  const color = colorRules ? getBarColor(value, above, below, primary, colorRules) : primary;
  const display = value > 0 && value < 1 ? `${(value * 100).toFixed(1)}%` : value.toLocaleString();
  return (
    <div className="flex items-center justify-center py-8">
      <span className="text-5xl font-extrabold" style={{ color }}>{display}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked Bar
// ---------------------------------------------------------------------------

function StackedBarChart({
  data, colors, formatValue,
}: { data: GroupedRow[]; colors: string[]; formatValue: (v: number) => string }) {
  const labels = [...new Set(data.map((d) => d.label))];
  const groups = [...new Set(data.map((d) => d.group))];

  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = data.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Legend />
        {groups.map((g, i) => (
          <Bar key={String(g)} dataKey={String(g)} stackId="a" fill={colors[i % colors.length]} radius={i === groups.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Grouped Bar
// ---------------------------------------------------------------------------

function GroupedBarChart({
  data, colors, formatValue,
}: { data: GroupedRow[]; colors: string[]; formatValue: (v: number) => string }) {
  const labels = [...new Set(data.map((d) => d.label))];
  const groups = [...new Set(data.map((d) => d.group))];

  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = data.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickFormatter={formatLabel} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
        <Tooltip formatter={(v) => formatValue(Number(v))} labelFormatter={formatLabel} />
        <Legend />
        {groups.map((g, i) => (
          <Bar key={String(g)} dataKey={String(g)} fill={colors[i % colors.length]} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Stacked Area
// ---------------------------------------------------------------------------

function StackedAreaChartView({
  data, colors, primary, formatValue,
}: { data: GroupedRow[]; colors: string[]; primary: string; formatValue: (v: number) => string }) {
  const labels = [...new Set(data.map((d) => d.label))];
  const groups = [...new Set(data.map((d) => d.group))];

  const pivoted = labels.map((label) => {
    const row: Record<string, string | number> = { label };
    groups.forEach((g) => {
      const found = data.find((d) => d.label === label && d.group === g);
      row[g] = found ? found.value : 0;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={pivoted} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
        <defs>
          {groups.map((g, i) => (
            <linearGradient key={String(g)} id={`areaG_${i}`} x1="0" y1="0" x2="0" y2="1">
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
          <Area
            key={String(g)}
            type="monotone"
            dataKey={String(g)}
            stackId="a"
            stroke={colors[i % colors.length]}
            fill={`url(#areaG_${i})`}
            fillOpacity={1}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Heatmap (pure SVG — Recharts has no native heatmap)
// ---------------------------------------------------------------------------

function HeatmapChart({ data, primary }: { data: HeatmapRow[]; primary: string }) {
  if (!data.length) return null;

  const rows = [...new Set(data.map((d) => d.row))];
  const cols = [...new Set(data.map((d) => d.col))];
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const CELL_W = Math.max(36, Math.min(80, Math.floor(520 / cols.length)));
  const CELL_H = 32;
  const LEFT_PAD = 120;
  const TOP_PAD = 40;
  const svgW = LEFT_PAD + cols.length * CELL_W + 8;
  const svgH = TOP_PAD + rows.length * CELL_H + 8;

  function opacity(v: number) {
    if (max === min) return 0.7;
    return 0.1 + 0.85 * ((v - min) / (max - min));
  }

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} style={{ display: "block" }}>
        {/* Column headers */}
        {cols.map((col, ci) => (
          <text
            key={col}
            x={LEFT_PAD + ci * CELL_W + CELL_W / 2}
            y={TOP_PAD - 6}
            textAnchor="middle"
            fontSize={10}
            fill="hsl(var(--muted-foreground))"
          >
            {String(col).length > 8 ? String(col).slice(0, 7) + "…" : col}
          </text>
        ))}
        {/* Row headers + cells */}
        {rows.map((row, ri) => (
          <g key={row}>
            <text
              x={LEFT_PAD - 6}
              y={TOP_PAD + ri * CELL_H + CELL_H / 2}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={10}
              fill="hsl(var(--muted-foreground))"
            >
              {String(row).length > 14 ? String(row).slice(0, 13) + "…" : row}
            </text>
            {cols.map((col, ci) => {
              const cell = data.find((d) => d.row === row && d.col === col);
              const v = cell?.value ?? 0;
              return (
                <g key={col}>
                  <rect
                    x={LEFT_PAD + ci * CELL_W}
                    y={TOP_PAD + ri * CELL_H}
                    width={CELL_W - 2}
                    height={CELL_H - 2}
                    rx={3}
                    fill={primary}
                    fillOpacity={opacity(v)}
                    stroke="hsl(var(--border))"
                    strokeWidth={0.5}
                  />
                  <text
                    x={LEFT_PAD + ci * CELL_W + CELL_W / 2}
                    y={TOP_PAD + ri * CELL_H + CELL_H / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={9}
                    fill={opacity(v) > 0.5 ? "#fff" : "hsl(var(--foreground))"}
                  >
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

// ---------------------------------------------------------------------------
// Boxplot (custom SVG)
// ---------------------------------------------------------------------------

function BoxplotChart({
  data, primary, colors,
}: { data: BoxplotRow[]; primary: string; colors: string[] }) {
  if (!data.length) return null;

  const allVals = data.flatMap((d) => [d.min, d.max]);
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);
  const range = globalMax - globalMin || 1;

  const HEIGHT = 220;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 50;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const toY = (v: number) => PAD_TOP + plotH - ((v - globalMin) / range) * plotH;

  const itemW = Math.max(40, Math.min(90, Math.floor(540 / data.length)));
  const svgW = 60 + data.length * itemW;

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={HEIGHT} style={{ display: "block" }}>
        {/* Y-axis guide lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const yy = PAD_TOP + plotH * (1 - t);
          const val = globalMin + range * t;
          return (
            <g key={t}>
              <line x1={50} y1={yy} x2={svgW} y2={yy} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={46} y={yy} textAnchor="end" dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">
                {formatValue(val)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = 60 + i * itemW + itemW / 2;
          const color = colors[i % colors.length];
          const bw = Math.min(itemW * 0.55, 40);

          return (
            <g key={d.label}>
              {/* Whiskers */}
              <line x1={cx} y1={toY(d.min)} x2={cx} y2={toY(d.q1)} stroke={color} strokeWidth={1.5} />
              <line x1={cx} y1={toY(d.q3)} x2={cx} y2={toY(d.max)} stroke={color} strokeWidth={1.5} />
              <line x1={cx - bw / 2} y1={toY(d.min)} x2={cx + bw / 2} y2={toY(d.min)} stroke={color} strokeWidth={1.5} />
              <line x1={cx - bw / 2} y1={toY(d.max)} x2={cx + bw / 2} y2={toY(d.max)} stroke={color} strokeWidth={1.5} />
              {/* IQR box */}
              <rect
                x={cx - bw / 2}
                y={toY(d.q3)}
                width={bw}
                height={Math.max(2, toY(d.q1) - toY(d.q3))}
                rx={3}
                fill={color}
                fillOpacity={0.25}
                stroke={color}
                strokeWidth={1.5}
              />
              {/* Median */}
              <line x1={cx - bw / 2} y1={toY(d.median)} x2={cx + bw / 2} y2={toY(d.median)} stroke={color} strokeWidth={2.5} />
              {/* Label */}
              <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
                {String(d.label).length > 8 ? String(d.label).slice(0, 7) + "…" : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error Bar chart (ComposedChart)
// ---------------------------------------------------------------------------

function ErrorBarChart({
  data, primary, formatValue,
}: { data: ErrorbarRow[]; primary: string; formatValue: (v: number) => string }) {
  const rechartData = data.map((d) => ({
    label: d.label,
    value: d.value,
    errorY: [d.value - d.lower, d.upper - d.value] as [number, number],
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rechartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
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

// ---------------------------------------------------------------------------
// Candlestick (custom SVG — Recharts has no native candlestick)
// ---------------------------------------------------------------------------

function CandlestickChart({
  data, above, below,
}: { data: CandleRow[]; above: string; below: string }) {
  if (!data.length) return null;

  const allVals = data.flatMap((d) => [d.low, d.high]);
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);
  const range = globalMax - globalMin || 1;

  const HEIGHT = 240;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 44;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const toY = (v: number) => PAD_TOP + plotH - ((v - globalMin) / range) * plotH;

  const itemW = Math.max(20, Math.min(60, Math.floor(560 / data.length)));
  const svgW = 60 + data.length * itemW;
  const bw = Math.max(6, itemW * 0.5);

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={HEIGHT} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const yy = PAD_TOP + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={55} y1={yy} x2={svgW} y2={yy} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={50} y={yy} textAnchor="end" dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">
                {formatValue(globalMin + range * t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = 60 + i * itemW + itemW / 2;
          const bullish = d.close >= d.open;
          const color = bullish ? above : below;
          const bodyTop = toY(Math.max(d.open, d.close));
          const bodyBot = toY(Math.min(d.open, d.close));
          const bodyH = Math.max(2, bodyBot - bodyTop);

          return (
            <g key={i}>
              {/* High-low wick */}
              <line x1={cx} y1={toY(d.high)} x2={cx} y2={toY(d.low)} stroke={color} strokeWidth={1.5} />
              {/* Body */}
              <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH} rx={1} fill={color} fillOpacity={bullish ? 0.85 : 0.7} stroke={color} strokeWidth={1} />
              {/* Date label */}
              <text x={cx} y={HEIGHT - 6} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">
                {String(d.date).slice(-5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Span / Range Bar (custom SVG)
// ---------------------------------------------------------------------------

function SpanChart({
  data, primary, colors, formatValue,
}: { data: SpanRow[]; primary: string; colors: string[]; formatValue: (v: number) => string }) {
  if (!data.length) return null;

  const allVals = data.flatMap((d) => [d.min, d.max]);
  const globalMin = Math.min(...allVals);
  const globalMax = Math.max(...allVals);
  const range = globalMax - globalMin || 1;

  const BAR_H = 22;
  const GAP = 8;
  const LEFT_PAD = 130;
  const RIGHT_PAD = 60;
  const TOP_PAD = 24;
  const PLOT_W = 400;
  const svgW = LEFT_PAD + PLOT_W + RIGHT_PAD;
  const svgH = TOP_PAD + data.length * (BAR_H + GAP) + 8;

  const toX = (v: number) => LEFT_PAD + ((v - globalMin) / range) * PLOT_W;

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} style={{ display: "block" }}>
        {/* X-axis ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const xx = LEFT_PAD + t * PLOT_W;
          return (
            <g key={t}>
              <line x1={xx} y1={TOP_PAD - 4} x2={xx} y2={svgH - 8} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={xx} y={TOP_PAD - 7} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">
                {formatValue(globalMin + range * t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const y = TOP_PAD + i * (BAR_H + GAP);
          const x1 = toX(d.min);
          const x2 = toX(d.max);
          const color = colors[i % colors.length];

          return (
            <g key={d.label}>
              <text x={LEFT_PAD - 6} y={y + BAR_H / 2} textAnchor="end" dominantBaseline="central" fontSize={10} fill="hsl(var(--muted-foreground))">
                {String(d.label).length > 16 ? String(d.label).slice(0, 15) + "…" : d.label}
              </text>
              <rect x={x1} y={y} width={Math.max(3, x2 - x1)} height={BAR_H} rx={4} fill={color} fillOpacity={0.75} />
              <text x={x2 + 4} y={y + BAR_H / 2} dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">
                {formatValue(d.max)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tick / Strip chart (jitter dots per category)
// ---------------------------------------------------------------------------

function TickChart({
  data, primary, colors, formatValue,
}: { data: LabelValue[]; primary: string; colors: string[]; formatValue: (v: number) => string }) {
  const vals = data.map((d) => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const HEIGHT = 100;
  const LEFT_PAD = 8;
  const W = 560;
  const svgW = LEFT_PAD + W + 60;

  const toX = (v: number) => LEFT_PAD + ((v - minV) / range) * W;

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={HEIGHT + 40} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const xx = LEFT_PAD + t * W;
          return (
            <g key={t}>
              <line x1={xx} y1={20} x2={xx} y2={HEIGHT + 8} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={xx} y={14} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))">
                {formatValue(minV + range * t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const jitter = ((i % 5) - 2) * 6;
          return (
            <g key={i}>
              <circle
                cx={toX(d.value)}
                cy={HEIGHT / 2 + jitter}
                r={5}
                fill={colors[i % colors.length]}
                fillOpacity={0.75}
                stroke="hsl(var(--background))"
                strokeWidth={1}
              />
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word Cloud (sized text layout)
// ---------------------------------------------------------------------------

function WordCloud({ data, colors }: { data: LabelValue[]; colors: string[] }) {
  if (!data.length) return null;

  const sorted = [...data].sort((a, b) => b.value - a.value).slice(0, 40);
  const maxVal = sorted[0]?.value || 1;

  return (
    <div className="flex flex-wrap gap-2 justify-center items-center py-4 px-2">
      {sorted.map((d, i) => {
        const size = 12 + Math.round((d.value / maxVal) * 22);
        return (
          <span
            key={i}
            style={{
              fontSize: size,
              color: colors[i % colors.length],
              fontWeight: d.value / maxVal > 0.6 ? 700 : d.value / maxVal > 0.3 ? 500 : 400,
              opacity: 0.75 + 0.25 * (d.value / maxVal),
            }}
            title={`${d.label}: ${d.value}`}
          >
            {d.label}
          </span>
        );
      })}
    </div>
  );
}