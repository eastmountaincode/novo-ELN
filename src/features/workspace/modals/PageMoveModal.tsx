"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import type { Notebook, PageEntry } from "@/lib/types";

type PageMoveModalProps = {
  page: PageEntry;
  currentNotebookId: string;
  notebooks: Notebook[];
  moving: boolean;
  onCancel: () => void;
  onConfirm: (notebookId: string) => void;
};

export function PageMoveModal({ page, currentNotebookId, notebooks, moving, onCancel, onConfirm }: PageMoveModalProps) {
  const destinationNotebooks = useMemo(
    () => notebooks
      .filter((notebook) => notebook.id !== currentNotebookId && (notebook.accessRole === "owner" || notebook.accessRole === "editor"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [currentNotebookId, notebooks],
  );
  const [targetNotebookId, setTargetNotebookId] = useState(destinationNotebooks[0]?.id ?? "");
  const validTargetNotebookId = destinationNotebooks.some((notebook) => notebook.id === targetNotebookId)
    ? targetNotebookId
    : destinationNotebooks[0]?.id ?? "";
  const canMove = Boolean(validTargetNotebookId) && !moving;

  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Move page</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Choose the notebook that should contain <span className="font-semibold text-white">{page.title || "Untitled page"}</span>.
      </p>
      {destinationNotebooks.length ? (
        <label className="mt-4 block text-sm font-medium text-slate-200">
          Destination notebook
          <select
            value={validTargetNotebookId}
            onChange={(event) => setTargetNotebookId(event.target.value)}
            disabled={moving}
            className="mt-2 h-10 w-full cursor-pointer border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {destinationNotebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-4 border border-white/10 bg-white/5 p-3 text-sm text-slate-300">No editable destination notebooks are available.</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={moving} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={() => onConfirm(validTargetNotebookId)} disabled={!canMove} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-400">
          {moving ? <Loader2 size={15} className="animate-spin" /> : null}
          {moving ? "Moving..." : "Move page"}
        </button>
      </div>
    </ModalFrame>
  );
}
