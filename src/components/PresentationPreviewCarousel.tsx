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
  const previewHeight = large ? "h-full" : "h-[260px]";

  return (
    <div className={`border-t border-neutral-200 bg-white ${large ? "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]" : ""}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 text-xs text-neutral-600">
        <span className="font-medium tabular-nums">Slide {activeSlide.index} / {slideCount}</span>
        <div className="flex items-center gap-1">
          <button type="button" tabIndex={large ? 0 : -1} onClick={selectPrevious} disabled={activeIndex === 0} className="grid size-7 place-items-center border border-neutral-300 bg-white text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 hover:not-disabled:bg-neutral-50" aria-label="Previous slide">
            <ChevronLeft size={15} />
          </button>
          <button type="button" tabIndex={large ? 0 : -1} onClick={selectNext} disabled={activeIndex >= slideCount - 1} className="grid size-7 place-items-center border border-neutral-300 bg-white text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 hover:not-disabled:bg-neutral-50" aria-label="Next slide">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className={`${previewHeight} min-h-0 overflow-hidden bg-neutral-100 p-3`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activeSlide.imageUrl} alt={`${filename} slide ${activeSlide.index}`} className="mx-auto block h-full w-full border border-neutral-300 bg-white object-contain shadow-sm" draggable={false} />
      </div>
      {large && slides.length > 1 ? (
        <div className="flex min-h-0 gap-2 overflow-x-auto border-t border-neutral-200 bg-neutral-50 p-2 scroll-contained">
          {slides.map((slide, index) => (
            <button
              key={slide.index}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`grid w-24 shrink-0 grid-rows-[3.5rem_1rem] gap-1 border p-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-neutral-600 ${index === activeIndex ? "border-neutral-700 bg-neutral-200" : "border-neutral-300 bg-white hover:bg-neutral-100"}`}
              aria-label={`Show slide ${slide.index}`}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slide.imageUrl} alt="" className="h-14 w-full bg-white object-contain" draggable={false} />
              <span className="flex items-center justify-center text-[10px] font-medium leading-none tabular-nums text-neutral-700">{slide.index}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
