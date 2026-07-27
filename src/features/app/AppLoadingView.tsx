import { Loader2 } from "lucide-react";
import { NovoDeploymentLabel, NovoWordmark } from "@/components/NovoInstanceProvider";

export function AppLoadingView() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 text-slate-600">
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col items-center">
          <div className="novo-wordmark select-none text-7xl leading-none tracking-normal text-slate-950"><NovoWordmark /></div>
          <NovoDeploymentLabel className="mt-2 text-xs font-medium leading-none text-slate-500" />
        </div>
        <span className="inline-flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Loading...</span>
      </div>
    </main>
  );
}
