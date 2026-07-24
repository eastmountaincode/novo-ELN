import { CalendarPlus, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AdminAppSettings } from "@/lib/types";

export function AppSettingsPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [settings, setSettings] = useState<AdminAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/settings")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { settings?: AdminAppSettings; error?: string } | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load app settings.");
          return;
        }
        setSettings(body?.settings ?? null);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load app settings.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateAppSettings(patch: Partial<AdminAppSettings>) {
    if (!settings || saving) return;
    const previous = settings;
    const optimistic = { ...settings, ...patch };
    setError("");
    setSaving(true);
    setSettings(optimistic);
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = (await response.json().catch(() => null)) as { settings?: AdminAppSettings; error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setSettings(previous);
      setError(body?.error ?? "Unable to update app settings.");
      return;
    }
    setSettings(body?.settings ?? optimistic);
    await onChanged();
  }

  return (
    <section className="max-w-2xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 border-b border-slate-200 p-5">
        <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <CalendarPlus size={21} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">App Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Defaults for this Novo instance.</p>
        </div>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading settings...</p>
      ) : (
        <div className="divide-y divide-slate-100">
          <label className="flex cursor-pointer items-start gap-3 p-5">
            <input
              type="checkbox"
              checked={Boolean(settings?.prependDateToNewPages)}
              onChange={(event) => void updateAppSettings({ prependDateToNewPages: event.target.checked })}
              disabled={saving || !settings}
              className="mt-1 size-4 cursor-pointer border-slate-300 disabled:cursor-wait"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-950">Add today&apos;s date to new pages</span>
              <span className="mt-1 block text-sm text-slate-500">New pages start with a first line like &quot;May 28, 2026&quot;.</span>
            </span>
            {saving ? <Loader2 size={16} className="mt-1 shrink-0 animate-spin text-slate-400" /> : null}
          </label>
          <label className="flex cursor-pointer items-start gap-3 p-5">
            <input
              type="checkbox"
              checked={Boolean(settings?.suggestTagsGlobally)}
              onChange={(event) => void updateAppSettings({ suggestTagsGlobally: event.target.checked })}
              disabled={saving || !settings}
              className="mt-1 size-4 cursor-pointer border-slate-300 disabled:cursor-wait"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-950">Suggest tags from all notebooks</span>
              <span className="mt-1 block text-sm text-slate-500">Page tag suggestions use tags from every notebook the user can access instead of only the current notebook.</span>
            </span>
            {saving ? <Loader2 size={16} className="mt-1 shrink-0 animate-spin text-slate-400" /> : null}
          </label>
        </div>
      )}
    </section>
  );
}
