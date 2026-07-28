"use client";

import { NotebookText as NotebookIcon, Users } from "lucide-react";
import { useState } from "react";
import { NotebookAccessList } from "@/features/notebooks/settings/NotebookAccessList";
import { NotebookMemberRemovalModal } from "@/features/notebooks/settings/NotebookMemberRemovalModal";
import { NotebookOverviewGroup } from "@/features/notebooks/settings/NotebookOverviewGroup";
import { NotebookShareForm } from "@/features/notebooks/settings/NotebookShareForm";
import { NotebookTitleTemplateSettings } from "@/features/notebooks/settings/NotebookTitleTemplateSettings";
import { formatDateTime } from "@/lib/dateTime";
import { formatBytes } from "@/lib/formatBytes";
import type { AccessRole, AppUser, Notebook, ShareMember } from "@/lib/types";

type NotebookSettingsViewProps = {
  notebook: Notebook;
  user: AppUser;
  members: AppUser[];
  renameNotebook: (notebook: Notebook) => void;
  deleteNotebook: (notebook: Notebook) => void;
  onChanged: () => Promise<void>;
};

export function NotebookSettingsView({
  notebook,
  user,
  members,
  renameNotebook,
  deleteNotebook,
  onChanged,
}: NotebookSettingsViewProps) {
  const canManage = notebook.accessRole === "owner";
  const canEdit = canManage || notebook.accessRole === "editor";
  const effectiveRoleLabel = user.role === "admin" ? "Admin" : capitalizeLabel(notebook.accessRole);
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<ShareMember | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const attachmentCount = notebook.pages.reduce((total, page) => total + (page.attachmentCount ?? page.attachments.length), 0);
  const attachmentBytes = notebook.pages.reduce((total, page) => total + (page.attachmentBytes ?? page.attachments.reduce((sum, attachment) => sum + attachment.size, 0)), 0);
  const memberCount = notebook.members.length;

  async function addNotebookMember(input: { email: string; role: AccessRole }) {
    await fetch(`/api/notebooks/${notebook.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(assertOk);
    await onChanged();
  }

  async function updateNotebookMemberRole(member: ShareMember, role: AccessRole) {
    await addNotebookMember({ email: member.email, role });
  }

  async function removeMember(member: ShareMember) {
    await fetch(`/api/notebooks/${notebook.id}/members/${member.userId}`, { method: "DELETE" }).then(assertOk);
    await onChanged();
  }

  async function confirmMemberRemoval() {
    if (!memberPendingRemoval || removingMember) return;
    setRemovingMember(true);
    try {
      await removeMember(memberPendingRemoval);
      setMemberPendingRemoval(null);
    } finally {
      setRemovingMember(false);
    }
  }

  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500">Notebook</p>
            <div className="mt-1 flex min-w-0 items-center gap-3">
              <span className="size-3 shrink-0" style={{ backgroundColor: notebook.color }} />
              <h1 className="min-w-0 truncate text-2xl font-semibold text-slate-950">{notebook.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? <button type="button" onClick={() => renameNotebook(notebook)} className="h-9 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:border-slate-500">Rename</button> : null}
            {canManage ? <button type="button" onClick={() => deleteNotebook(notebook)} className="h-9 border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50">Delete</button> : null}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,680px)_320px] lg:items-start">
          <div className="space-y-6">
            <section className="border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <NotebookIcon size={17} className="text-slate-500" />
                <h2 className="text-base font-semibold text-slate-950">Notebook overview</h2>
              </div>
              <div className="space-y-5">
                <NotebookOverviewGroup
                  title="Identity"
                  rows={[{ label: "Notebook ID", value: notebook.id }]}
                />
                <NotebookOverviewGroup
                  title="Contents"
                  rows={[
                    { label: "Pages", value: notebook.pages.length.toLocaleString() },
                    { label: "Attachments", value: attachmentCount.toLocaleString() },
                    { label: "Storage", value: formatBytes(attachmentBytes) },
                  ]}
                />
                <NotebookOverviewGroup
                  title="Access"
                  rows={[
                    { label: "Members", value: memberCount.toLocaleString() },
                    { label: "Your role", value: effectiveRoleLabel },
                  ]}
                />
                <NotebookOverviewGroup
                  title="Dates"
                  rows={[
                    { label: "Created", value: formatDateTime(notebook.createdAt) },
                    { label: "Updated", value: formatDateTime(notebook.updatedAt) },
                  ]}
                />
              </div>
            </section>

            <NotebookTitleTemplateSettings
              key={JSON.stringify([notebook.id, notebook.pageTitleTemplate, notebook.pageTitleTemplateEnabled])}
              notebookId={notebook.id}
              savedValue={notebook.pageTitleTemplate ?? ""}
              savedEnabled={Boolean(notebook.pageTitleTemplateEnabled)}
              notebookColor={notebook.color}
              canManage={canManage}
              onChanged={onChanged}
            />

            <section className="border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <Users size={17} className="text-slate-500" />
                <h2 className="text-base font-semibold text-slate-950">Notebook access</h2>
              </div>
              <NotebookAccessList
                members={notebook.members}
                currentUserId={user.id}
                canManage={canManage}
                onRoleChange={updateNotebookMemberRole}
                onRemove={setMemberPendingRemoval}
              />
            </section>
          </div>

          <section className="border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-950">Share notebook</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Add a group member and choose their notebook role.</p>
            <div className="mt-4">
              <NotebookShareForm
                members={members}
                existingMembers={notebook.members}
                submitLabel="Share"
                disabled={!canManage}
                disabledReason={!canManage ? "Only notebook owners and admins can share this notebook." : undefined}
                onSubmit={addNotebookMember}
              />
            </div>
          </section>
        </div>
      </div>

      {memberPendingRemoval ? (
        <NotebookMemberRemovalModal
          member={memberPendingRemoval}
          isCurrentUser={memberPendingRemoval.userId === user.id}
          removing={removingMember}
          onCancel={() => setMemberPendingRemoval(null)}
          onConfirm={confirmMemberRemoval}
        />
      ) : null}
    </section>
  );
}

async function assertOk(response: Response) {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? "Request failed.");
}

function capitalizeLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
