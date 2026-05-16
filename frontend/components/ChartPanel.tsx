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
} from "recharts";
import type { ChartSpec } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getPalette } from "@/lib/palettes";
import { Plus, Check } from "lucide-react";
import { useState } from "react";

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
  if (value >= 1000) return value.toLocaleString();
  if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

interface Props {
  chart: ChartSpec;
}

export function ChartPanel({ chart }: Props) {
  const { type, title, data, color_rules, sql, explanation } = chart;
  const { profile, updateSettings } = useAuth();
  const palette = getPalette(profile?.settings?.color_palette);
  const { colors, primary, above, below } = palette;

  const [isSaving, setIsSaving] = useState(false);
  const [isSavedLocal, setIsSavedLocal] = useState(false);

  const savedWidgets = profile?.settings?.saved_widgets || [];
  const alreadySaved = savedWidgets.some((w) => w.chart.sql === sql) || isSavedLocal;

  const handleSaveWidget = async () => {
    if (isSaving || alreadySaved || !profile) return;
    setIsSaving(true);
    
    const newWidget = {
      id: crypto.randomUUID(),
      name: title || "New Widget",
      chart,
    };

    const currentWidgets = profile.settings?.saved_widgets || [];
    await updateSettings({ saved_widgets: [newWidget, ...currentWidgets] });
    
    setIsSaving(false);
    setIsSavedLocal(true);
  };

  return (
    <div className="w-full rounded-xl border bg-card shadow-sm overflow-hidden mt-2">
      <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          {explanation && (
            <p className="text-xs text-muted-foreground mt-0.5">{explanation}</p>
          )}
        </div>
        <button
          onClick={handleSaveWidget}
          disabled={isSaving || alreadySaved}
          title={alreadySaved ? "Already saved to dashboard" : "Save to dashboard"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-background hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {alreadySaved ? <Check className="h-3 w-3 text-emerald-500" /> : <Plus className="h-3 w-3" />}
          {alreadySaved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="px-2 pb-4">
        {type === "kpi" && !Array.isArray(data) && (
          <KpiCard value={(data as { value: number }).value} colorRules={color_rules} primary={primary} above={above} below={below} />
        )}

        {type === "bar" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(v) => formatValue(Number(v))} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {(data as Array<{ label: string; value: number }>).map((entry, i) => (
                  <Cell key={i} fill={getBarColor(entry.value, above, below, colors[i % colors.length], color_rules)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {type === "line" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(v) => formatValue(Number(v))} />
              <Line type="monotone" dataKey="y" stroke={primary} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {type === "area" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
              <Tooltip formatter={(v) => formatValue(Number(v))} />
              <Area type="monotone" dataKey="y" stroke={primary} fill="url(#areaGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {type === "pie" && Array.isArray(data) && (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(1)}%`}
                labelLine={false}
              >
                {(data as Array<{ label: string; value: number }>).map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatValue(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

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

      <details className="px-4 pb-3">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
          View SQL
        </summary>
        <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {sql}
        </pre>
      </details>
    </div>
  );
}

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
