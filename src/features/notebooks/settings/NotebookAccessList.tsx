import { Crown, Eye, Pencil, Shield, X } from "lucide-react";
import type { AccessRole, ShareMember } from "@/lib/types";
import { userDisplayName } from "@/lib/workspaceDisplay";
import { NotebookRoleSelect } from "@/features/notebooks/settings/NotebookRoleSelect";

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
                <NotebookRoleSelect
                  value={member.role}
                  onValueChange={(role) => void onRoleChange(member, role)}
                  ariaLabel={`Access for ${userDisplayName(member)}`}
                />
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
