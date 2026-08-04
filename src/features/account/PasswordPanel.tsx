import { KeyRound } from "lucide-react";
import { useState } from "react";
import { passwordRequirementText } from "@/lib/passwordRequirements";

export function PasswordPanel({ embedded = false }: { embedded?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || !currentPassword || !nextPassword || !confirmPassword;

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError("");
    if (nextPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setSubmitting(true);
    const response = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, nextPassword }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Password change failed.");
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
    setStatus("Password updated.");
  }

  const form = (
    <form onSubmit={(event) => void submitPassword(event)} className="grid gap-4">
      <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
      <PasswordField label="New password" value={nextPassword} onChange={setNextPassword} autoComplete="new-password" />
      <p className="-mt-2 text-xs leading-5 text-slate-500">{passwordRequirementText}</p>
      <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
      {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {status ? <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</p> : null}
      <div>
        <button disabled={disabled} className="h-9 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
          {submitting ? "Saving" : "Update password"}
        </button>
      </div>
    </form>
  );

  if (embedded) return form;

  return (
    <section className="max-w-2xl border border-slate-200 bg-white p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <KeyRound size={21} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Change password</h2>
        </div>
      </div>
      {form}
    </section>
  );
}

function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="password"
        autoComplete={autoComplete}
        className="mt-1 h-10 w-full border border-slate-300 px-3 text-slate-950 outline-none focus:border-cyan-600"
      />
    </label>
  );
}
