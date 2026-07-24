"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import type { Notebook, Project } from "@/lib/types";

export type NameDialogState =
  | { kind: "createProject" }
  | { kind: "createNotebook"; projectId: string; projectName: string }
  | { kind: "renameProject"; project: Project }
  | { kind: "renameNotebook"; notebook: Notebook };

type NameModalProps = {
  dialog: NameDialogState;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
};

export function NameModal({ dialog, onCancel, onSubmit }: NameModalProps) {
  const initialValue = dialog.kind === "renameProject"
    ? dialog.project.name
    : dialog.kind === "renameNotebook"
      ? dialog.notebook.name
      : "";
  const [name, setName] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = getNameModalTitle(dialog);
  const description = getNameModalDescription(dialog);
  const submitLabel = dialog.kind.startsWith("rename") ? "Rename" : "Create";
  const pendingSubmitLabel = dialog.kind.startsWith("rename") ? "Renaming..." : "Creating...";
  const disabled = !name.trim() || submitting;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(name);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalFrame>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        <label className="mt-5 block text-sm font-medium text-slate-200">
          Name
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
            placeholder="Name"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">
            Cancel
          </button>
          <button type="submit" disabled={disabled} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            {submitting ? pendingSubmitLabel : submitLabel}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function getNameModalTitle(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "New project";
  if (dialog.kind === "createNotebook") return "New notebook";
  if (dialog.kind === "renameProject") return "Rename project";
  return "Rename notebook";
}

function getNameModalDescription(dialog: NameDialogState) {
  if (dialog.kind === "createProject") return "Create a project to group related notebooks.";
  if (dialog.kind === "createNotebook") return "Create a notebook.";
  if (dialog.kind === "renameProject") return "Update the project name shown in the sidebar.";
  return "Update the notebook name shown in the sidebar.";
}
