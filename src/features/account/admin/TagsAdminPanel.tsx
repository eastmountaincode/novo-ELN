import { ChevronDown, ChevronUp, Loader2, RefreshCw, Tag, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import { formatDateTime } from "@/lib/dateTime";
import type { AdminTag } from "@/lib/types";

type AdminTagSortKey = "label" | "pages" | "notebooks" | "lastUsed";
type SortDirection = "asc" | "desc";

export function TagsAdminPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<AdminTagSortKey>("label");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [renameTarget, setRenameTarget] = useState<AdminTag | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [savingTagId, setSavingTagId] = useState("");
  const [mergeSource, setMergeSource] = useState<AdminTag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminTag | null>(null);

  async function loadTags(showSpinner = true) {
    if (showSpinner) setRefreshing(true);
    setError("");
    const response = await fetch("/api/admin/tags");
    const body = (await response.json().catch(() => null)) as { tags?: AdminTag[]; error?: string } | null;
    if (showSpinner) setRefreshing(false);
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load tags.");
      return;
    }
    setTags(body?.tags ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTags(false);
  }, []);

  function startRename(tag: AdminTag) {
    setError("");
    setMergeSource(null);
    setDeleteTarget(null);
    setRenameTarget(tag);
    setDraftLabel(tag.label);
  }

  async function renameTag() {
    if (!renameTarget) return;
    const label = draftLabel.trim().replace(/\s+/g, " ");
    if (!label || label === renameTarget.label || savingTagId) {
      setRenameTarget(null);
      return;
    }
    setError("");
    setSavingTagId(renameTarget.id);
    const response = await fetch("/api/admin/tags", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: renameTarget.id, label }),
    });
    const body = (await response.json().catch(() => null)) as { tags?: AdminTag[]; error?: string } | null;
    setSavingTagId("");
    if (!response.ok) {
      setError(body?.error ?? "Unable to rename tag.");
      return;
    }
    setRenameTarget(null);
    setTags(body?.tags ?? []);
    await onChanged();
  }

  function startMerge(tag: AdminTag) {
    setError("");
    setRenameTarget(null);
    setDeleteTarget(null);
    setMergeSource(tag);
    setMergeTargetId(tags.find((candidate) => candidate.id !== tag.id)?.id ?? "");
  }

  async function mergeSelectedTag() {
    if (!mergeSource || !mergeTargetId || savingTagId) return;
    setError("");
    setSavingTagId(mergeSource.id);
    const response = await fetch("/api/admin/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceTagId: mergeSource.id, targetTagId: mergeTargetId }),
    });
    const body = (await response.json().catch(() => null)) as { tags?: AdminTag[]; error?: string } | null;
    setSavingTagId("");
    if (!response.ok) {
      setError(body?.error ?? "Unable to merge tags.");
      return;
    }
    setMergeSource(null);
    setMergeTargetId("");
    setTags(body?.tags ?? []);
    await onChanged();
  }

  async function deleteSelectedTag() {
    if (!deleteTarget || savingTagId) return;
    setError("");
    setSavingTagId(deleteTarget.id);
    const response = await fetch(`/api/admin/tags?tagId=${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
    const body = (await response.json().catch(() => null)) as { tags?: AdminTag[]; error?: string } | null;
    setSavingTagId("");
    if (!response.ok) {
      setError(body?.error ?? "Unable to delete tag.");
      return;
    }
    setDeleteTarget(null);
    setTags(body?.tags ?? []);
    await onChanged();
  }

  const mergeTarget = tags.find((tag) => tag.id === mergeTargetId) ?? null;
  const sortedTags = useMemo(() => {
    const directionMultiplier = sortDirection === "asc" ? 1 : -1;
    return [...tags].sort((first, second) => {
      let comparison = 0;
      if (sortKey === "label") {
        comparison = first.label.localeCompare(second.label, undefined, { sensitivity: "base", numeric: true });
      } else if (sortKey === "pages") {
        comparison = first.pageCount - second.pageCount;
      } else if (sortKey === "notebooks") {
        comparison = first.notebookCount - second.notebookCount;
      } else {
        if (!first.updatedAt && !second.updatedAt) comparison = 0;
        else if (!first.updatedAt) return 1;
        else if (!second.updatedAt) return -1;
        else comparison = (new Date(first.updatedAt).getTime() - new Date(second.updatedAt).getTime()) * directionMultiplier;
      }
      if (comparison === 0) {
        comparison = first.label.localeCompare(second.label, undefined, { sensitivity: "base", numeric: true });
      }
      if (sortKey === "lastUsed") return comparison;
      return comparison * directionMultiplier;
    });
  }, [sortDirection, sortKey, tags]);

  function toggleSort(nextSortKey: AdminTagSortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "lastUsed" ? "desc" : "asc");
  }

  function renderSortHeader(column: AdminTagSortKey, label: string) {
    const active = sortKey === column;
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-slate-900 ${active ? "text-slate-900" : "text-slate-500"}`}
      >
        <span>{label}</span>
        {active ? (
          sortDirection === "asc" ? (
            <ChevronUp size={13} strokeWidth={2} className="text-slate-600" />
          ) : (
            <ChevronDown size={13} strokeWidth={2} className="text-slate-600" />
          )
        ) : null}
      </button>
    );
  }

  return (
    <>
      <section className="max-w-5xl border border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
              <Tag size={21} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Tags</h2>
            </div>
          </div>
          <button
            onClick={() => void loadTags(true)}
            disabled={loading || refreshing}
            className="inline-flex h-9 items-center gap-2 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
          >
            {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Refresh
          </button>
        </div>

        {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        {loading ? (
          <p className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />Loading tags...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[20%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold" aria-sort={sortKey === "label" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    {renderSortHeader("label", "Tag")}
                  </th>
                  <th className="px-3 py-2 font-semibold" aria-sort={sortKey === "pages" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    {renderSortHeader("pages", "Pages")}
                  </th>
                  <th className="px-3 py-2 font-semibold" aria-sort={sortKey === "notebooks" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    {renderSortHeader("notebooks", "Notebooks")}
                  </th>
                  <th className="px-3 py-2 font-semibold" aria-sort={sortKey === "lastUsed" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    {renderSortHeader("lastUsed", "Last used")}
                  </th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedTags.map((tag) => {
                  const saving = savingTagId === tag.id;
                  return (
                    <tr key={tag.id}>
                      <td className="px-3 py-2 align-middle">
                        <p className="whitespace-normal break-words font-semibold text-slate-950 [overflow-wrap:anywhere]">{tag.label}</p>
                      </td>
                      <td className="px-3 py-2 align-middle text-slate-700">{tag.pageCount.toLocaleString()}</td>
                      <td className="px-3 py-2 align-middle text-slate-700">{tag.notebookCount.toLocaleString()}</td>
                      <td className="px-3 py-2 align-middle text-xs leading-5 text-slate-500">{tag.updatedAt ? formatDateTime(tag.updatedAt) : "None"}</td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                          <button type="button" onClick={() => startRename(tag)} disabled={saving} className="h-8 border border-slate-300 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400">Rename</button>
                          <button type="button" onClick={() => startMerge(tag)} disabled={tags.length < 2 || saving} className="h-8 border border-slate-300 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400">Merge</button>
                          <button type="button" onClick={() => { setMergeSource(null); setRenameTarget(null); setDeleteTarget(tag); }} disabled={saving} className="h-8 border border-rose-200 px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-wait disabled:text-rose-300">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tags.length === 0 ? <p className="p-5 text-sm text-slate-500">No tags found.</p> : null}
          </div>
        )}
      </section>

      {renameTarget ? (
        <ModalFrame>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-white">Rename tag</h2>
            <button type="button" onClick={() => setRenameTarget(null)} disabled={savingTagId === renameTarget.id} className="text-slate-400 hover:text-white disabled:opacity-50">
              <X size={18} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Rename <span className="font-semibold text-white">{renameTarget.label}</span> everywhere it appears.
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-200">
            Tag name
            <input
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void renameTag();
                if (event.key === "Escape") setRenameTarget(null);
              }}
              disabled={savingTagId === renameTarget.id}
              className="mt-2 h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400 disabled:opacity-60"
              autoFocus
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setRenameTarget(null)} disabled={savingTagId === renameTarget.id} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
            <button onClick={() => void renameTag()} disabled={savingTagId === renameTarget.id} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-400">
              {savingTagId === renameTarget.id ? <Loader2 size={15} className="animate-spin" /> : null}
              {savingTagId === renameTarget.id ? "Renaming..." : "Rename tag"}
            </button>
          </div>
        </ModalFrame>
      ) : null}

      {mergeSource ? (
        <ModalFrame>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-white">Merge tag</h2>
            <button type="button" onClick={() => setMergeSource(null)} disabled={savingTagId === mergeSource.id} className="text-slate-400 hover:text-white disabled:opacity-50">
              <X size={18} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Pages with <span className="font-semibold text-white">{mergeSource.label}</span> will use the selected tag instead. The old tag will be removed.
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-200">
            Merge into
            <select
              value={mergeTargetId}
              onChange={(event) => setMergeTargetId(event.target.value)}
              disabled={savingTagId === mergeSource.id}
              className="mt-2 h-10 w-full cursor-pointer border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {tags.filter((tag) => tag.id !== mergeSource.id).map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.label}</option>
              ))}
            </select>
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setMergeSource(null)} disabled={savingTagId === mergeSource.id} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
            <button onClick={() => void mergeSelectedTag()} disabled={!mergeTarget || savingTagId === mergeSource.id} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-400">
              {savingTagId === mergeSource.id ? <Loader2 size={15} className="animate-spin" /> : null}
              {savingTagId === mergeSource.id ? "Merging..." : "Merge tags"}
            </button>
          </div>
        </ModalFrame>
      ) : null}

      {deleteTarget ? (
        <ModalFrame>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-white">Delete tag?</h2>
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={savingTagId === deleteTarget.id} className="text-slate-400 hover:text-white disabled:opacity-50">
              <X size={18} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            This removes <span className="font-semibold text-white">{deleteTarget.label}</span> from {deleteTarget.pageCount.toLocaleString()} {deleteTarget.pageCount === 1 ? "page" : "pages"}. It does not delete any pages.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setDeleteTarget(null)} disabled={savingTagId === deleteTarget.id} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
            <button onClick={() => void deleteSelectedTag()} disabled={savingTagId === deleteTarget.id} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
              {savingTagId === deleteTarget.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              {savingTagId === deleteTarget.id ? "Deleting..." : "Delete tag"}
            </button>
          </div>
        </ModalFrame>
      ) : null}
    </>
  );
}
