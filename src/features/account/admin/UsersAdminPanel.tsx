import { ChevronDown, ChevronUp, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModalFrame } from "@/components/ModalFrame";
import { formatDateTime } from "@/lib/dateTime";
import { passwordRequirementText } from "@/lib/passwordRequirements";
import type { AdminUser } from "@/lib/types";
import { userDisplayName } from "@/lib/workspaceDisplay";

type AdminUserSortKey = "user" | "role" | "notebooks" | "lastLogin" | "lastActivity" | "created";
type SortDirection = "asc" | "desc";

export function UsersAdminPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [sortKey, setSortKey] = useState<AdminUserSortKey>("user");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  async function loadUsers() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/users");
    const body = (await response.json().catch(() => null)) as { users?: AdminUser[]; error?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "Unable to load users.");
      return;
    }
    setUsers(body?.users ?? []);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/users")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { users?: AdminUser[]; error?: string } | null;
        if (!active) return;
        setLoading(false);
        if (!response.ok) {
          setError(body?.error ?? "Unable to load users.");
          return;
        }
        setUsers(body?.users ?? []);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError("Unable to load users.");
      });
    return () => {
      active = false;
    };
  }, []);

  const sortedUsers = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) * direction;
    const compareNumber = (a: number, b: number) => (a - b) * direction;
    const compareNullableDate = (a: string | null | undefined, b: string | null | undefined) => {
      if (!a && !b) return 0;
      if (!a) return sortDirection === "asc" ? -1 : 1;
      if (!b) return sortDirection === "asc" ? 1 : -1;
      return (new Date(a).getTime() - new Date(b).getTime()) * direction;
    };

    return [...users].sort((a, b) => {
      switch (sortKey) {
        case "user":
          return compareText(`${userDisplayName(a)} ${a.email}`, `${userDisplayName(b)} ${b.email}`);
        case "role":
          return compareText(a.role, b.role);
        case "notebooks":
          return compareNumber(a.notebookCount, b.notebookCount);
        case "lastLogin":
          return compareNullableDate(a.lastLoginAt, b.lastLoginAt);
        case "lastActivity":
          return compareNullableDate(a.lastActivityAt, b.lastActivityAt);
        case "created":
          return compareNullableDate(a.createdAt, b.createdAt);
      }
    });
  }, [sortDirection, sortKey, users]);

  function toggleSort(nextSortKey: AdminUserSortKey) {
    if (sortKey === nextSortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(["lastLogin", "lastActivity", "created"].includes(nextSortKey) ? "desc" : "asc");
  }

  function renderSortHeader(column: AdminUserSortKey, label: string) {
    const active = sortKey === column;
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className={`inline-flex items-center gap-1 font-semibold hover:text-slate-900 ${active ? "text-slate-900" : "text-slate-500"}`}
      >
        <span>{label}</span>
        {active ? (
          sortDirection === "asc" ? (
            <ChevronUp size={13} strokeWidth={2} className="text-slate-600" />
          ) : (
            <ChevronDown size={13} strokeWidth={2} className="text-slate-600" />
          )
        ) : null}
      </button>
    );
  }

  return (
    <section className="max-w-5xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center border border-slate-200 bg-slate-50 text-slate-600">
            <Shield size={21} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Users</h2>
          </div>
        </div>
        <button onClick={() => void loadUsers()} className="h-9 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">Refresh</button>
      </div>
      {error ? <p className="m-5 border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="p-5 text-sm text-slate-500">Loading users...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3">{renderSortHeader("user", "User")}</th>
                <th className="px-3 py-3">{renderSortHeader("role", "Role")}</th>
                <th className="px-3 py-3">{renderSortHeader("notebooks", "Notebooks")}</th>
                <th className="px-3 py-3">{renderSortHeader("lastLogin", "Last login")}</th>
                <th className="px-3 py-3">{renderSortHeader("lastActivity", "Last activity")}</th>
                <th className="px-3 py-3">{renderSortHeader("created", "Created")}</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedUsers.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-3">
                    <div className="truncate font-medium text-slate-950">{userDisplayName(user)}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-3 py-3 capitalize text-slate-700">{user.role}</td>
                  <td className="px-3 py-3 text-slate-700">{user.notebookCount}</td>
                  <td className="px-3 py-3 text-xs leading-5 text-slate-500">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</td>
                  <td className="px-3 py-3 text-xs leading-5 text-slate-500">{user.lastActivityAt ? formatDateTime(user.lastActivityAt) : "None"}</td>
                  <td className="px-3 py-3 text-xs leading-5 text-slate-500">{formatDateTime(user.createdAt)}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => setResetUser(user)}
                      className="min-h-8 border border-slate-300 px-3 py-1 text-sm leading-5 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={user.id === currentUserId}
                      title={user.id === currentUserId ? "Use Security to change your own password" : "Set temporary password"}
                    >
                      Set password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 ? <p className="p-5 text-sm text-slate-500">No users found.</p> : null}
        </div>
      )}
      {resetUser ? (
        <AdminPasswordModal
          user={resetUser}
          onCancel={() => setResetUser(null)}
          onSaved={() => {
            setResetUser(null);
            void loadUsers();
          }}
        />
      ) : null}
    </section>
  );
}


function AdminPasswordModal({ user, onCancel, onSaved }: { user: AdminUser; onCancel: () => void; onSaved: () => void }) {
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || !nextPassword || !confirmPassword;

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (nextPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const response = await fetch(`/api/admin/users/${user.id}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextPassword }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Password reset failed.");
      return;
    }
    onSaved();
  }

  return (
    <ModalFrame>
      <form onSubmit={(event) => void submitPassword(event)}>
        <h2 className="text-lg font-semibold text-white">Set temporary password</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Update the password for <span className="font-semibold text-white">{user.email}</span>. Give them this password directly, then they can change it from their account page.
        </p>
        <div className="mt-5 grid gap-4">
          <label className="block text-sm font-medium text-slate-200">
            New password
            <input
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              type="password"
              className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none focus:border-cyan-400"
              autoComplete="new-password"
            />
          </label>
          <p className="-mt-2 text-xs leading-5 text-slate-400">{passwordRequirementText}</p>
          <label className="block text-sm font-medium text-slate-200">
            Confirm password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              className="mt-2 h-10 w-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none focus:border-cyan-400"
              autoComplete="new-password"
            />
          </label>
        </div>
        {error ? <p className="mt-4 border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={disabled} className="h-9 bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">
            {submitting ? "Saving" : "Set password"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
