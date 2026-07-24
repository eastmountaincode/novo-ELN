import type { ReactNode } from "react";

export function ModalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-6">
      <div className="w-full max-w-md border border-white/10 bg-slate-900 p-5 shadow-2xl shadow-slate-950/50">
        {children}
      </div>
    </div>
  );
}
