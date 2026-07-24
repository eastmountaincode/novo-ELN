"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import type { Notebook } from "@/lib/types";

type NotebookDeleteModalProps = {
  notebook: Notebook;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function NotebookDeleteModal({ notebook, deleting, onCancel, onConfirm }: NotebookDeleteModalProps) {
  const [confirmationName, setConfirmationName] = useState("");
  const canDelete = confirmationName.trim() === notebook.name && !deleting;

  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete notebook?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{notebook.name}</span>, including its pages and attachment records. This cannot be undone.
      </p>
      <label className="mt-5 block text-sm font-medium text-slate-200" htmlFor="delete-notebook-confirmation">
        Type the notebook name to confirm
      </label>
      <input
        id="delete-notebook-confirmation"
        value={confirmationName}
        onChange={(event) => setConfirmationName(event.target.value)}
        disabled={deleting}
        className="mt-2 h-10 w-full border border-white/15 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-400 disabled:opacity-60"
        placeholder={notebook.name}
      />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={deleting} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={!canDelete} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
          {deleting ? "Deleting..." : "Delete notebook"}
        </button>
      </div>
    </ModalFrame>
  );
}
