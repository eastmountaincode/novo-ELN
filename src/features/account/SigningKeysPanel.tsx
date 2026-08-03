import { Fingerprint, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/dateTime";
import type { UserSigningKey } from "@/lib/types";

type SigningKeysResponse = {
  keys?: UserSigningKey[];
  error?: string;
};

export function SigningKeysPanel({ embedded = false }: { embedded?: boolean }) {
  const [keys, setKeys] = useState<UserSigningKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const activeKey = keys.find((key) => key.active) ?? null;

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
        {embedded ? (
          <h3 className="mb-4 text-sm font-semibold text-slate-950">Signing keys</h3>
        ) : (
          <div className="mb-5 flex items-start gap-3">
            <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
              <Fingerprint size={21} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Active signing key</h2>
            </div>
          </div>
        )}

        {error ? <p className="mb-4 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

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
          <dl className="grid gap-3 text-sm">
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-slate-950">Pending next sign-in</dd>
            </div>
          </dl>
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
