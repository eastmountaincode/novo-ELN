"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import type { FormEventHandler } from "react";
import { NovoDeploymentLabel, NovoWordmark } from "@/components/NovoInstanceProvider";

type AuthViewProps = {
  submitting: boolean;
  error: string;
  email: string;
  password: string;
  showPassword: boolean;
  rememberDevice: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onShowPasswordChange: (show: boolean) => void;
  onRememberDeviceChange: (remember: boolean) => void;
};

export function AuthView({
  submitting,
  error,
  email,
  password,
  showPassword,
  rememberDevice,
  onSubmit,
  onEmailChange,
  onPasswordChange,
  onShowPasswordChange,
  onRememberDeviceChange,
}: AuthViewProps) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-950">
      <form onSubmit={onSubmit} className="grid w-full max-w-sm gap-4 border border-slate-200 bg-white p-6 shadow-sm">
        <header className="grid gap-1">
          <p className="novo-wordmark select-none text-3xl leading-none tracking-normal text-slate-950"><NovoWordmark /></p>
          <NovoDeploymentLabel className="text-xs font-medium leading-none text-slate-500" />
        </header>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <h1 className="text-base font-semibold text-slate-700">Sign in</h1>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Email
              <input value={email} onChange={(event) => onEmailChange(event.target.value)} type="email" disabled={submitting} className="h-10 w-full border border-slate-300 px-3 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50" autoComplete="username" />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Password
            <div className="relative">
              <input
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                type={showPassword ? "text" : "password"}
                disabled={submitting}
                className="h-10 w-full border border-slate-300 px-3 pr-10 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => onShowPasswordChange(!showPassword)}
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input checked={rememberDevice} onChange={(event) => onRememberDeviceChange(event.target.checked)} disabled={submitting} type="checkbox" className="size-4 border border-slate-300 accent-slate-950 disabled:cursor-not-allowed" />
            Remember this device for 14 days
          </label>
          {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <button disabled={submitting} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
