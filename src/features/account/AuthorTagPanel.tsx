import { Loader2, Pencil, Tag } from "lucide-react";
import { useState } from "react";
import type { AppUser } from "@/lib/types";

export function AuthorTagPanel({ user, onChanged }: { user: AppUser; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [authorTag, setAuthorTag] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function startEditing() {
    setAuthorTag(user.authorTag ?? "");
    setError("");
    setEditing(true);
  }

  async function submitAuthorTag(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorTag }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Author tag update failed.");
        return;
      }
      await onChanged();
      setEditing(false);
    } catch {
      setError("Unable to save the author tag. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border border-slate-200 bg-white p-5" aria-labelledby="author-tag-heading">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
          <Tag size={21} />
        </div>
        <h2 id="author-tag-heading" className="min-w-0 flex-1 text-lg font-semibold text-slate-950">Author tag</h2>
        {!editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="grid size-9 shrink-0 place-items-center border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            title="Edit author tag"
            aria-label="Edit author tag"
          >
            <Pencil size={15} />
          </button>
        ) : null}
      </div>
      {editing ? (
        <form onSubmit={(event) => void submitAuthorTag(event)} className="grid gap-4 border-t border-slate-100 pt-4">
          <label className="grid gap-1 text-sm">
            <span className="sr-only">Author tag</span>
            <input
              value={authorTag}
              onChange={(event) => setAuthorTag(event.target.value)}
              required
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              disabled={submitting}
              className="h-10 border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-cyan-600 disabled:opacity-60"
            />
          </label>
          {error ? <p role="alert" className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={submitting} className="h-9 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !authorTag.trim()} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      ) : (
        <p className="break-words border-t border-slate-100 pt-3 text-sm text-slate-950">{user.authorTag || "Not set"}</p>
      )}
    </section>
  );
}
