"use client";

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { AccessRole, AppUser, ShareMember } from "@/lib/types";
import { userDisplayName } from "@/lib/workspaceDisplay";

type NotebookShareFormProps = {
  members: AppUser[];
  existingMembers: ShareMember[];
  submitLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  onSubmit: (input: { email: string; role: AccessRole }) => Promise<void>;
};

export function NotebookShareForm({
  members,
  existingMembers,
  submitLabel,
  disabled: disabledByPermission = false,
  disabledReason,
  onSubmit,
}: NotebookShareFormProps) {
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<AppUser | null>(null);
  const [role, setRole] = useState<AccessRole>("editor");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const existingMemberIds = useMemo(() => new Set(existingMembers.map((member) => member.userId)), [existingMembers]);
  const availableMembers = useMemo(() => members.filter((member) => !existingMemberIds.has(member.id)), [existingMemberIds, members]);
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const filtered = normalizedQuery
      ? availableMembers.filter((member) => `${userDisplayName(member)} ${member.email}`.toLowerCase().includes(normalizedQuery))
      : availableMembers;
    return filtered.slice(0, 8);
  }, [availableMembers, normalizedQuery]);
  const formDisabled = disabledByPermission || submitting || !selectedMember;

  function selectMember(member: AppUser) {
    setSelectedMember(member);
    setQuery(userDisplayName(member));
    setFocused(false);
    setError("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formDisabled || !selectedMember) return;
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({ email: selectedMember.email, role });
      setQuery("");
      setSelectedMember(null);
      setRole("editor");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to share.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">
        Group member
        <div className="relative mt-1">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedMember(null);
              setFocused(true);
            }}
            onFocus={() => !disabledByPermission && setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            type="text"
            autoComplete="off"
            disabled={disabledByPermission}
            placeholder="Search by full name or email"
            className="h-9 w-full border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
          />
          {focused && !disabledByPermission ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto border border-slate-300 bg-white py-1 shadow-lg">
              {suggestions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMember(member)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  <span className="block truncate font-medium text-slate-950">{userDisplayName(member)}</span>
                  <span className="block truncate text-xs text-slate-500">{member.email}</span>
                </button>
              ))}
              {suggestions.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">No available members found.</p> : null}
            </div>
          ) : null}
        </div>
      </label>
      <div className="flex gap-2">
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as AccessRole)}
          disabled={disabledByPermission}
          className="h-9 flex-1 cursor-pointer border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button disabled={formDisabled} className="inline-flex h-9 items-center gap-2 bg-slate-950 px-3 text-sm font-semibold text-white disabled:bg-slate-300">
          {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
          {submitting ? "Sharing..." : submitLabel}
        </button>
      </div>
      {disabledReason ? <p className="text-xs text-slate-500">{disabledReason}</p> : null}
      {selectedMember ? <p className="text-xs text-slate-500">Sharing with {userDisplayName(selectedMember)} ({selectedMember.email})</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </form>
  );
}
