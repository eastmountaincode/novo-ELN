"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

type ResizeHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  disabled?: boolean;
};

export function ResizeHandle({ onPointerDown, disabled = false }: ResizeHandleProps) {
  return (
    <div className={`group relative z-20 w-px bg-slate-200 ${disabled ? "" : "hover:bg-cyan-500"}`} title={disabled ? undefined : "Drag to resize"}>
      <div onPointerDown={disabled ? undefined : onPointerDown} className={`absolute -left-[5px] top-0 h-full w-[11px] ${disabled ? "" : "cursor-col-resize"}`} />
    </div>
  );
}
