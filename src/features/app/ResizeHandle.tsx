"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

type ResizeHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  disabled?: boolean;
};

export function ResizeHandle({ onPointerDown, disabled = false }: ResizeHandleProps) {
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onPointerDown(event);
  }

  return (
    <div className={`group relative z-20 w-px bg-slate-200 ${disabled ? "" : "hover:bg-cyan-500"}`} title={disabled ? undefined : "Drag to resize"}>
      <div onPointerDown={disabled ? undefined : handlePointerDown} className={`absolute -left-[5px] top-0 h-full w-[11px] select-none touch-none ${disabled ? "" : "cursor-col-resize"}`} />
    </div>
  );
}
