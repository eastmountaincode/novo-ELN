import { Loader2, Pencil, UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppUser } from "@/lib/types";
import { userDisplayName } from "@/lib/workspaceDisplay";

export function AccountProfile({ user, onChanged }: { user: AppUser; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editing) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve the existing prop-to-draft synchronization during this mechanical extraction.
    setFirstName(user.firstName);
    setLastName(user.lastName);
  }, [editing, user.firstName, user.lastName]);

  function cancelEditing() {
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setError("");
    setEditing(false);
  }

  async function submitProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Profile update failed.");
        return;
      }
      setEditing(false);
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="max-w-2xl space-y-4">
      <div className="border border-slate-200 bg-white p-5">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <UserCircle size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-950">{userDisplayName(user)}</h2>
            <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="grid size-9 shrink-0 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              title="Edit profile"
              aria-label="Edit profile"
            >
              <Pencil size={15} />
            </button>
          ) : null}
        </div>
        {editing ? (
          <form onSubmit={(event) => void submitProfile(event)} className="grid gap-4 border-t border-slate-100 pt-4">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">First name</span>
              <input
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-cyan-600"
                autoComplete="given-name"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Last name</span>
              <input
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="h-10 border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-cyan-600"
                autoComplete="family-name"
              />
            </label>
            {error ? <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancelEditing} disabled={submitting} className="h-9 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                Cancel
              </button>
              <button type="submit" disabled={submitting || !firstName.trim()} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-3 text-sm">
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">First name</dt>
              <dd className="text-slate-950">{user.firstName || "Not set"}</dd>
            </div>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-t border-slate-100 pt-3">
              <dt className="text-slate-500">Last name</dt>
              <dd className="text-slate-950">{user.lastName || "Not set"}</dd>
            </div>
          </dl>
        )}
      </div>

    </section>
  );
}
