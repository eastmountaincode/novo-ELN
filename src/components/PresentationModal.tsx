"use client";

import { Download, Presentation, X } from "lucide-react";
import { PresentationPreviewCarousel } from "@/components/PresentationPreviewCarousel";

type InlineAttachmentAttrs = {
  attachmentId: string;
  filename: string;
};

export function PresentationModal({ attachment, onClose }: { attachment: InlineAttachmentAttrs; onClose: () => void }) {
  const downloadUrl = `/api/attachments/${attachment.attachmentId}/download`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-5">
      <div className="grid max-h-[90vh] w-full max-w-5xl grid-rows-[auto_1fr] border border-white/10 bg-slate-900 text-white shadow-2xl shadow-slate-950/50">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Presentation className="mt-1 shrink-0 text-cyan-300" size={24} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{attachment.filename}</h2>
              <p className="mt-1 text-sm text-slate-400">Preview slides rendered from the stored presentation.</p>
            </div>
          </div>
          <button onClick={onClose} className="grid size-8 shrink-0 place-items-center border border-white/10 text-slate-200 hover:bg-white/10" title="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 overflow-hidden bg-slate-100 text-slate-900">
          <PresentationPreviewCarousel attachmentId={attachment.attachmentId} filename={attachment.filename} large />
          <div className="flex justify-end border-t border-slate-300 bg-white p-3">
            <a href={downloadUrl} className="inline-flex h-9 items-center gap-2 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400"><Download size={15} />Download</a>
          </div>
        </div>
      </div>
    </div>
  );
}
