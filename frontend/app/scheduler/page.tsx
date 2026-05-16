"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  getSchedules,
  createSchedule,
  toggleSchedule,
  deleteSchedule,
  type ScheduledReport,
} from "@/lib/api";
import { Calendar, Clock, Mail, Plus, Trash2, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { value: i, label: `${h}:00 ${ampm}` };
});

// ---------------------------------------------------------------------------
// Empty form state
// ---------------------------------------------------------------------------
const EMPTY_FORM = {
  name: "",
  widget_ids: [] as string[],
  frequency: "weekly" as "daily" | "weekly",
  day_of_week: 0,
  hour: 9,
  email: "",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SchedulerPage() {
  const { session, profile } = useAuth();
  const token = session?.access_token ?? "";
  const savedWidgets = profile?.settings?.saved_widgets ?? [];

  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch schedules on mount
  useEffect(() => {
    if (!token) return;
    getSchedules(token)
      .then(setSchedules)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (form.widget_ids.length === 0) {
      setError("Select at least one widget.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createSchedule(token, {
        name:        form.name.trim(),
        widget_ids:  form.widget_ids,
        frequency:   form.frequency,
        day_of_week: form.frequency === "weekly" ? form.day_of_week : null,
        hour:        form.hour,
        email:       form.email.trim(),
      });
      setSchedules((prev) => [created, ...prev]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (s: ScheduledReport) => {
    try {
      const updated = await toggleSchedule(token, s.id, !s.enabled);
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this schedule?")) return;
    try {
      await deleteSchedule(token, id);
      setSchedules((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleWidget = (id: string) =>
    setForm((f) => ({
      ...f,
      widget_ids: f.widget_ids.includes(id)
        ? f.widget_ids.filter((w) => w !== id)
        : [...f.widget_ids, id],
    }));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Scheduled Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatically generate and email PDF reports on a schedule.
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Schedule
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* ── Create form ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="mb-6 rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <h2 className="font-semibold text-sm text-foreground">New Schedule</h2>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Report name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Weekly Monday Report"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Widgets */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Widgets to include</label>
            {savedWidgets.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No saved widgets yet. Save charts from the Dashboard first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {savedWidgets.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => toggleWidget(w.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      form.widget_ids.includes(w.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary"
                    }`}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Frequency + Day + Hour */}
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Frequency</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as "daily" | "weekly" }))}
                className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </select>
            </div>
            {form.frequency === "weekly" && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Day</label>
                <select
                  value={form.day_of_week}
                  onChange={(e) => setForm((f) => ({ ...f, day_of_week: Number(e.target.value) }))}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Time (UTC)</label>
              <select
                value={form.hour}
                onChange={(e) => setForm((f) => ({ ...f, hour: Number(e.target.value) }))}
                className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Recipient email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="you@example.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save Schedule
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setError(null); }}
              className="px-4 py-2 rounded-md text-sm font-medium border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Schedule list ───────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading schedules…
        </div>
      ) : schedules.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center text-muted-foreground text-sm">
          No schedules yet. Click <strong>New Schedule</strong> to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              savedWidgets={savedWidgets}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule card
// ---------------------------------------------------------------------------
function ScheduleCard({
  schedule: s,
  savedWidgets,
  onToggle,
  onDelete,
}: {
  schedule: ScheduledReport;
  savedWidgets: { id: string; name: string }[];
  onToggle: (s: ScheduledReport) => void;
  onDelete: (id: string) => void;
}) {
  const widgetNames = s.widget_ids
    .map((id) => savedWidgets.find((w) => w.id === id)?.name ?? id)
    .join(", ");

  const freqLabel = s.frequency === "weekly"
    ? `Every ${DAYS[s.day_of_week ?? 0]}`
    : "Every day";

  const hourLabel = HOURS[s.hour]?.label ?? `${s.hour}:00`;

  const nextRun = s.next_run_at
    ? new Date(s.next_run_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";

  return (
    <div className={`rounded-xl border bg-card p-4 shadow-sm transition-opacity ${s.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm text-foreground truncate">{s.name}</span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              s.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            }`}>
              {s.enabled ? "Active" : "Paused"}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{freqLabel}</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{hourLabel} UTC</span>
            <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{s.email}</span>
          </div>

          {widgetNames && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              <span className="font-medium">Widgets:</span> {widgetNames}
            </p>
          )}

          {s.next_run_at && (
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-medium">Next send:</span> {nextRun}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggle(s)}
            title={s.enabled ? "Pause" : "Resume"}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {s.enabled
              ? <ToggleRight className="h-5 w-5 text-emerald-500" />
              : <ToggleLeft className="h-5 w-5" />}
          </button>
          <button
            onClick={() => onDelete(s.id)}
            title="Delete"
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
