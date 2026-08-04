import { Fingerprint, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/dateTime";
import type { UserSigningKey } from "@/lib/types";

type SigningKeysResponse = {
  keys?: UserSigningKey[];
  error?: string;
};

export function SigningKeysPanel({ embedded = false }: { embedded?: boolean }) {
  const [keys, setKeys] = useState<UserSigningKey[]>([]);
  const [signingPassphrase, setSigningPassphrase] = useState("");
  const [signingPassphraseConfirmation, setSigningPassphraseConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const activeKey = keys.find((key) => key.active) ?? null;
  const createDisabled = submitting || !signingPassphrase || !signingPassphraseConfirmation;

  useEffect(() => {
    let cancelled = false;

    async function loadKeys() {
      const response = await fetch("/api/account/signing-keys");
      const body = (await response.json().catch(() => null)) as SigningKeysResponse | null;
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        setError(body?.error ?? "Signing keys could not be loaded.");
        return;
      }
      setKeys(body?.keys ?? []);
    }

    void loadKeys();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitSigningKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setStatus("");
    if (signingPassphrase !== signingPassphraseConfirmation) {
      setError("Signing passphrases do not match.");
      return;
    }
    setSubmitting(true);
    const response = await fetch("/api/account/signing-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signingPassphrase, signingPassphraseConfirmation }),
    });
    const body = (await response.json().catch(() => null)) as SigningKeysResponse | null;
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Signing key setup failed.");
      return;
    }
    setSigningPassphrase("");
    setSigningPassphraseConfirmation("");
    setKeys(body?.keys ?? []);
    setStatus("Signing key ready.");
  }

  if (loading) {
    return (
      <section className={embedded ? "" : "max-w-4xl border border-slate-200 bg-white p-5"}>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Loading signing keys
        </div>
      </section>
    );
  }

  return (
    <section className={embedded ? "space-y-5" : "max-w-4xl space-y-6"}>
      <div className={embedded ? "" : "border border-slate-200 bg-white p-5"}>
        {embedded ? null : (
          <div className="mb-5 flex items-start gap-3">
            <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
              <Fingerprint size={21} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Signing keys</h2>
            </div>
          </div>
        )}

        {error ? <p className="mb-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {status ? <p className="mb-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{status}</p> : null}

        {activeKey ? (
          <dl className="grid gap-3 text-sm">
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">Algorithm</dt>
              <dd className="font-medium uppercase text-slate-950">{activeKey.algorithm}</dd>
            </div>
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">Fingerprint</dt>
              <dd className="break-all font-mono text-xs text-slate-700">{activeKey.publicKeyFingerprint}</dd>
            </div>
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-950">{formatDateTime(activeKey.createdAt)}</dd>
            </div>
            <div className="grid gap-2 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">Public key</dt>
              <dd>
                <textarea readOnly value={activeKey.publicKey} rows={7} className="w-full resize-y border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700 outline-none" />
              </dd>
            </div>
          </dl>
        ) : (
          <form onSubmit={(event) => void submitSigningKey(event)} className="grid max-w-2xl gap-4">
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-slate-950">No active key</dd>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Signing passphrase
              <input
                value={signingPassphrase}
                onChange={(event) => setSigningPassphrase(event.target.value)}
                type="password"
                autoComplete="new-password"
                minLength={12}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-slate-950 outline-none focus:border-cyan-600"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Confirm signing passphrase
              <input
                value={signingPassphraseConfirmation}
                onChange={(event) => setSigningPassphraseConfirmation(event.target.value)}
                type="password"
                autoComplete="new-password"
                minLength={12}
                className="mt-1 h-10 w-full border border-slate-300 px-3 text-slate-950 outline-none focus:border-cyan-600"
              />
            </label>
            <div>
              <button disabled={createDisabled} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                {submitting ? "Creating" : "Create signing key"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className={embedded ? "border-t border-slate-100 pt-5" : "border border-slate-200 bg-white p-5"}>
        <h2 className={embedded ? "text-sm font-semibold text-slate-950" : "text-lg font-semibold text-slate-950"}>Key history</h2>
        {keys.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Fingerprint</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Revoked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="py-2 pr-4 font-medium text-slate-950">{key.active ? "Active" : "Historic"}</td>
                    <td className="break-all py-2 pr-4 font-mono text-xs text-slate-700">{key.publicKeyFingerprint}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatDateTime(key.createdAt)}</td>
                    <td className="py-2 pr-4 text-slate-500">{key.revokedAt ? formatDateTime(key.revokedAt) : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No signing keys.</p>
        )}
      </div>
    </section>
  );
}
