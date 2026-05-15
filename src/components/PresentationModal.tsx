"use client";

import { Download, Presentation, X } from "lucide-react";

type InlineAttachmentAttrs = {
  attachmentId: string;
  filename: string;
};

export function PresentationModal({ attachment, onClose }: { attachment: InlineAttachmentAttrs; onClose: () => void }) {
  const downloadUrl = `/api/attachments/${attachment.attachmentId}/download`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-5">
      <div className="w-full max-w-xl border border-white/10 bg-slate-900 p-5 text-white shadow-2xl shadow-slate-950/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Presentation className="mt-1 shrink-0 text-cyan-300" size={24} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{attachment.filename}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Presentation preview is wired as a modal placeholder for now. The file is stored with the note and can be downloaded from here or from the inline card.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center border border-white/10 text-slate-200 hover:bg-white/10" title="Close"><X size={16} /></button>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <a href={downloadUrl} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400"><Download size={15} />Download</a>
        </div>
      </div>
    </div>
  );
}
