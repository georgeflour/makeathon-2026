"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Moon, Palette, Sun, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PALETTES } from "@/lib/palettes";

export default function SettingsPage() {
  const { profile, saveProfile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [selectedPalette, setSelectedPalette] = useState("ocean");
  const [selectedTheme, setSelectedTheme] = useState<"light" | "dark">("dark");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setSelectedPalette(profile.settings.color_palette ?? "ocean");
    setSelectedTheme((profile.settings.theme as "light" | "dark") ?? "dark");
  }, [profile]);

  const handleThemePreview = (t: "light" | "dark") => {
    setSelectedTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
  };

  const handleSave = async () => {
    setIsSaving(true);
    await saveProfile({
      display_name: displayName.trim() || null,
      settings: { color_palette: selectedPalette, theme: selectedTheme },
    });
    localStorage.setItem("httf-theme", selectedTheme);
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-[#212121]">
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-white/40 mt-1">
            Manage your profile and appearance preferences.
          </p>
        </div>

        {/* Profile section */}
        <section className="space-y-5">
          <SectionHeader icon={<User className="h-4 w-4" />} title="Profile" />

          <div className="space-y-4">
            <Field label="Display name">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors text-sm"
              />
            </Field>

            <Field label="Email">
              <input
                type="email"
                value={profile?.email ?? ""}
                disabled
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-white/30 text-sm cursor-not-allowed"
              />
            </Field>
          </div>
        </section>

        {/* Appearance section */}
        <section className="space-y-5">
          <SectionHeader icon={<Palette className="h-4 w-4" />} title="Appearance" />

          {/* Theme */}
          <Field label="Theme">
            <div className="flex gap-3">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleThemePreview(t)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    selectedTheme === t
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:border-gray-300 dark:hover:border-white/20"
                  }`}
                >
                  {t === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  {t === "light" ? "Light" : "Dark"}
                  {selectedTheme === t && <Check className="h-3.5 w-3.5 ml-0.5" />}
                </button>
              ))}
            </div>
          </Field>

          {/* Chart palette */}
          <Field label="Chart palette">
            <div className="grid grid-cols-3 gap-2.5">
              {Object.values(PALETTES).map((palette) => (
                <button
                  key={palette.name}
                  onClick={() => setSelectedPalette(palette.name)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    selectedPalette === palette.name
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                      : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 bg-white dark:bg-white/[0.02]"
                  }`}
                >
                  <div className="flex gap-1 mb-2">
                    {palette.colors.slice(0, 5).map((c) => (
                      <div key={c} className="h-3 flex-1 rounded-sm" style={{ background: c }} />
                    ))}
                  </div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">
                    {palette.label}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-white/40">{palette.description}</p>
                </button>
              ))}
            </div>
          </Field>
        </section>

        {/* Save */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2"
          >
            {isSaving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              "Save changes"
            )}
          </button>
          {saved && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-gray-100 dark:border-white/5">
      <span className="text-gray-400 dark:text-white/30">{icon}</span>
      <h2 className="text-xs font-semibold text-gray-500 dark:text-white/40 uppercase tracking-widest">
        {title}
      </h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-white/70">{label}</label>
      {children}
    </div>
  );
}
