"use client";

import { Loader2 } from "lucide-react";
import { ModalFrame } from "@/components/ModalFrame";
import type { PageEntry } from "@/lib/types";

type PageDeleteModalProps = {
  page: PageEntry;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PageDeleteModal({ page, deleting, onCancel, onConfirm }: PageDeleteModalProps) {
  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">Delete page?</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This will delete <span className="font-semibold text-white">{page.title || "Untitled page"}</span>, including its attachment records. This cannot be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={deleting} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={deleting} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {deleting ? <Loader2 size={15} className="animate-spin" /> : null}
          {deleting ? "Deleting..." : "Delete page"}
        </button>
      </div>
    </ModalFrame>
  );
}
