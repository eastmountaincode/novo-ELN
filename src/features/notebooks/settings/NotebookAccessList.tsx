import { Crown, Eye, Pencil, Shield, X } from "lucide-react";
import type { AccessRole, ShareMember } from "@/lib/types";
import { userDisplayName } from "@/lib/workspaceDisplay";

const accessRoleIcons = {
  owner: Crown,
  editor: Pencil,
  viewer: Eye,
} satisfies Record<AccessRole, typeof Eye>;

type NotebookAccessListProps = {
  members: ShareMember[];
  currentUserId: string;
  canManage: boolean;
  onRoleChange: (member: ShareMember, role: AccessRole) => Promise<void>;
  onRemove: (member: ShareMember) => void;
};

export function NotebookAccessList({
  members,
  currentUserId,
  canManage,
  onRoleChange,
  onRemove,
}: NotebookAccessListProps) {
  if (!members.length) return <p className="text-sm text-slate-500">No members have access yet.</p>;

  return (
    <div className="space-y-2">
      {members.map((member) => {
        const isCurrentUser = member.userId === currentUserId;
        const isAppAdmin = member.appRole === "admin";
        const RoleIcon = isAppAdmin ? Shield : accessRoleIcons[member.role];
        const roleIconClass = isAppAdmin ? "text-cyan-700" : member.role === "owner" ? "text-amber-600" : "text-slate-500";
        const roleLabel = isAppAdmin ? "Admin" : member.role;
        const roleCanBeChanged = canManage && !isCurrentUser && !isAppAdmin;
        const roleCanBeRemoved = (canManage || isCurrentUser) && !isAppAdmin;

        return (
          <div key={member.userId} className="grid gap-3 border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_170px_36px] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-950">{userDisplayName(member)}{isCurrentUser ? <span className="ml-1 font-normal text-slate-500">(you)</span> : null}</p>
              <p className="truncate text-xs text-slate-500">{member.email}</p>
            </div>
            {roleCanBeChanged ? (
              <div className="flex min-w-0 items-center gap-2">
                <RoleIcon size={15} className={`shrink-0 ${roleIconClass}`} />
                <select
                  value={member.role}
                  onChange={(event) => void onRoleChange(member, event.target.value as AccessRole)}
                  className="h-9 min-w-0 flex-1 cursor-pointer border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none focus:border-cyan-600"
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm capitalize text-slate-600">
                <RoleIcon size={15} className={`shrink-0 ${roleIconClass}`} />
                {roleLabel}
              </span>
            )}
            {roleCanBeRemoved ? (
              <button
                type="button"
                onClick={() => onRemove(member)}
                className="grid size-9 place-items-center border border-slate-200 text-slate-500 hover:bg-slate-100"
                title={isCurrentUser ? "Leave notebook" : "Remove access"}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
