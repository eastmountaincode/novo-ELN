import { Loader2 } from "lucide-react";
import { ModalFrame } from "@/components/ModalFrame";
import type { ShareMember } from "@/lib/types";
import { userDisplayName } from "@/lib/workspaceDisplay";

type NotebookMemberRemovalModalProps = {
  member: ShareMember;
  isCurrentUser: boolean;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function NotebookMemberRemovalModal({
  member,
  isCurrentUser,
  removing,
  onCancel,
  onConfirm,
}: NotebookMemberRemovalModalProps) {
  const title = isCurrentUser ? "Leave notebook?" : "Remove notebook access?";
  const action = isCurrentUser ? "Leave notebook" : "Remove access";

  return (
    <ModalFrame>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        {isCurrentUser ? (
          <>You will lose access to this notebook unless another owner shares it with you again.</>
        ) : (
          <>This will remove <span className="font-semibold text-white">{userDisplayName(member)}</span> from this notebook.</>
        )}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} disabled={removing} className="h-9 border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button onClick={onConfirm} disabled={removing} className="inline-flex h-9 items-center gap-2 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">
          {removing ? <Loader2 size={15} className="animate-spin" /> : null}
          {removing ? "Working..." : action}
        </button>
      </div>
    </ModalFrame>
  );
}
