"use client";

import { RefreshCw, X } from "lucide-react";

type UpdateAvailableBannerProps = {
  preview: boolean;
  onDismiss: () => void;
};

export function UpdateAvailableBanner({ preview, onDismiss }: UpdateAvailableBannerProps) {
  return (
    <div className="fixed right-5 top-5 z-[70] w-[min(380px,calc(100vw-2.5rem))] border border-slate-200 bg-white p-4 shadow-xl shadow-slate-950/15">
      <div className="flex items-start gap-3">
        <RefreshCw size={18} className="mt-0.5 shrink-0 text-slate-600" />
        <div className="min-w-0 flex-1 pr-6">
          <p className="text-sm font-semibold text-slate-950">A new version of Novo is available.</p>
          {preview ? <p className="mt-1 text-xs text-slate-400">Preview mode</p> : null}
        </div>
        <button type="button" onClick={onDismiss} className="grid size-7 shrink-0 place-items-center border border-transparent text-slate-400 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700" aria-label="Dismiss update notice">
          <X size={15} />
        </button>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => void performAppUpdate()} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800">
          <RefreshCw size={15} />
          Update now
        </button>
      </div>
    </div>
  );
}

async function performAppUpdate() {
  if (typeof window === "undefined") return;
  if ("caches" in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
    } catch {
      // Cache cleanup is best-effort; the cache-busted navigation below is the important part.
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_novoUpdate", Date.now().toString());
  window.location.replace(url.toString());
}
