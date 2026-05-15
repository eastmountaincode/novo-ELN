"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PresentationPreview } from "@/lib/presentationPreview";

export function PresentationPreviewCarousel({ attachmentId, filename, large = false }: { attachmentId: string; filename: string; large?: boolean }) {
  const [preview, setPreview] = useState<PresentationPreview | null>(null);
  const [status, setStatus] = useState("Loading presentation preview");
  const [activeIndex, setActiveIndex] = useState(0);
  const slideCount = preview?.slideCount ?? 0;
  const activeSlide = useMemo(() => {
    if (!preview?.slides.length) return null;
    return preview.slides[Math.min(activeIndex, preview.slides.length - 1)] ?? preview.slides[0];
  }, [activeIndex, preview]);

  useEffect(() => {
    let active = true;
    async function loadPreview() {
      setStatus("Loading presentation preview");
      setPreview(null);
      setActiveIndex(0);
      try {
        const response = await fetch(`/api/attachments/${attachmentId}/preview/presentation`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { preview?: PresentationPreview; error?: string } | null;
        if (!response.ok || !body?.preview) throw new Error(body?.error || `Preview failed (${response.status})`);
        if (active) {
          setPreview(body.preview);
          setStatus("");
        }
      } catch (error) {
        if (active) {
          setPreview(null);
          setStatus(error instanceof Error ? error.message : "Unable to preview presentation");
        }
      }
    }
    void loadPreview();
    return () => {
      active = false;
    };
  }, [attachmentId]);

  function selectPrevious() {
    setActiveIndex((index) => Math.max(0, index - 1));
  }

  function selectNext() {
    setActiveIndex((index) => Math.min(slideCount - 1, index + 1));
  }

  if (!activeSlide) {
    return <div className="border-t border-slate-200 bg-white px-3 py-6 text-sm text-slate-500">{status || "No slide preview available."}</div>;
  }

  const slides = preview?.slides ?? [];

  return (
    <div className="border-t border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium tabular-nums">Slide {activeSlide.index} / {slideCount}</span>
        <div className="flex items-center gap-1">
          <button type="button" tabIndex={-1} onClick={selectPrevious} disabled={activeIndex === 0} className="grid size-7 place-items-center border border-slate-300 bg-white text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:not-disabled:bg-slate-50" aria-label="Previous slide">
            <ChevronLeft size={15} />
          </button>
          <button type="button" tabIndex={-1} onClick={selectNext} disabled={activeIndex >= slideCount - 1} className="grid size-7 place-items-center border border-slate-300 bg-white text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 hover:not-disabled:bg-slate-50" aria-label="Next slide">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className={`${large ? "max-h-[72vh]" : "max-h-[460px]"} overflow-auto bg-slate-200 p-3 scroll-contained`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activeSlide.imageUrl} alt={`${filename} slide ${activeSlide.index}`} className="mx-auto block max-h-none w-full max-w-full border border-slate-300 bg-white object-contain shadow-sm" draggable={false} />
      </div>
      {slides.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-slate-50 p-2 scroll-contained">
          {slides.map((slide, index) => (
            <button
              key={slide.index}
              type="button"
              tabIndex={-1}
              onClick={() => setActiveIndex(index)}
              className={`w-20 shrink-0 border p-1 text-left ${index === activeIndex ? "border-cyan-500 bg-cyan-50" : "border-slate-300 bg-white hover:bg-slate-100"}`}
              aria-label={`Show slide ${slide.index}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slide.imageUrl} alt="" className="aspect-video w-full bg-white object-contain" draggable={false} />
              <span className="mt-1 block text-center text-[10px] font-medium tabular-nums text-slate-600">{slide.index}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
