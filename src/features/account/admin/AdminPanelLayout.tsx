import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function AdminPanelHeader({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
  description?: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <Icon size={21} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function AdminLoadingState({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 p-5 text-sm text-slate-500">
      <Loader2 size={16} className="shrink-0 animate-spin" />
      <span>{children}</span>
    </p>
  );
}
