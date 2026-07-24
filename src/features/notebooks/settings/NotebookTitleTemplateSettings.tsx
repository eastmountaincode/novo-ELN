"use client";

import { CalendarPlus, Loader2 } from "lucide-react";
import { useState } from "react";
import { NotebookOverviewRow } from "@/features/notebooks/settings/NotebookOverviewRow";

type NotebookTitleTemplateSettingsProps = {
  notebookId: string;
  savedValue: string;
  savedEnabled: boolean;
  notebookColor: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
};

export function NotebookTitleTemplateSettings({
  notebookId,
  savedValue,
  savedEnabled,
  notebookColor,
  canManage,
  onChanged,
}: NotebookTitleTemplateSettingsProps) {
  const [value, setValue] = useState(savedValue);
  const [enabled, setEnabled] = useState(savedEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = value !== savedValue || enabled !== savedEnabled;

  async function persistPageTitleTemplate(template: string, nextEnabledValue: boolean) {
    const trimmedTemplate = template.trim();
    const nextEnabled = nextEnabledValue && trimmedTemplate.length > 0;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/notebooks/${notebookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageTitleTemplate: trimmedTemplate, pageTitleTemplateEnabled: nextEnabled }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Request failed.");
      }
      await onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save title template.");
    } finally {
      setSaving(false);
    }
  }

  async function savePageTitleTemplate() {
    if (!dirty || saving || !enabled) return;
    await persistPageTitleTemplate(value, enabled);
  }

  async function changePageTitleTemplateEnabled(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    if (!nextEnabled || value.trim().length > 0) {
      await persistPageTitleTemplate(value, nextEnabled);
    }
  }

  if (!canManage) {
    return (
      <section className="border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <CalendarPlus size={17} className="text-slate-500" />
          <h2 className="text-base font-semibold text-slate-950">New page title template</h2>
        </div>
        <dl className="space-y-2 text-sm">
          <NotebookOverviewRow label="Status" value={savedEnabled ? "On" : "Off"} />
          <NotebookOverviewRow label="Template" value={savedValue || "Untitled"} />
        </dl>
      </section>
    );
  }

  const saveDisabled = !enabled || !dirty || saving;
  const saveButtonStyle = saveDisabled ? undefined : { borderColor: notebookColor, color: notebookColor };
  const checkboxStyle = { accentColor: notebookColor };

  return (
    <section className="border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <CalendarPlus size={17} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-950">New page title template</h2>
      </div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-slate-800">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => void changePageTitleTemplateEnabled(event.target.checked)}
            aria-label="Use title template for new pages"
            style={checkboxStyle}
            className="size-4 cursor-pointer border-slate-300"
          />
          <span>Use this template for new pages</span>
        </div>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <input
            id="page-title-template"
            aria-label="New page title template"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Example: ChordBrach-Expt{number}"
            disabled={!enabled}
            className="min-w-[280px] flex-1 border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-slate-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            type="button"
            onClick={() => void savePageTitleTemplate()}
            disabled={saveDisabled}
            style={saveButtonStyle}
            className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 font-medium text-slate-700 disabled:border-slate-300 disabled:text-slate-400"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Save template
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Use {"{number}"} where Novo should insert the next number. Leave blank to use Untitled.</p>
        {error ? <p className="mt-2 text-xs font-medium text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}
