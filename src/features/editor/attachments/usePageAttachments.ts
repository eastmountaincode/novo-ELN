import { useEffect, useRef, useState } from "react";
import type { ExternalMutationContext } from "@/features/editor/page/pageEditingSession";
import type { PageUpdater } from "@/features/pages/workspacePageState";
import type { Attachment, BlockType, PageEntry } from "@/lib/types";
import {
  addAttachmentToPage,
  markInlineAttachmentInsertedInPage,
  removeAttachmentFromPage,
} from "./attachmentState";

export type PendingAttachmentUpload = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "failed";
};

type SaveStatusReporter = (status: string, options?: { clearAfterMs?: number }) => void;

type UsePageAttachmentsOptions = {
  page: PageEntry;
  canEdit: boolean;
  updatePage: (pageId: string, updater: PageUpdater) => void;
  reportSaveStatus: SaveStatusReporter;
  successStatusClearAfterMs: number;
  runPageMutation: <T>(
    mutation: (context: ExternalMutationContext) => Promise<T>,
  ) => Promise<T> | null;
  canApplyEditorMutation: () => boolean;
  removeAttachmentFromDraft: (attachmentId: string, authoritativeBody?: string) => Promise<boolean>;
};

export function usePageAttachments({
  page,
  canEdit,
  updatePage,
  reportSaveStatus,
  successStatusClearAfterMs,
  runPageMutation,
  canApplyEditorMutation,
  removeAttachmentFromDraft,
}: UsePageAttachmentsOptions) {
  const [pendingUploads, setPendingUploads] = useState<PendingAttachmentUpload[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function updatePendingUploads(updater: (current: PendingAttachmentUpload[]) => PendingAttachmentUpload[]) {
    if (mountedRef.current) setPendingUploads(updater);
  }

  async function uploadAttachments(files: FileList | File[] | undefined) {
    if (!canEdit) return;
    const uploadFiles = Array.from(files ?? []).filter((file) => file.size >= 0);
    if (!uploadFiles.length) return;
    const mutation = runPageMutation(async () => {
      const pending = uploadFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        status: "uploading" as const,
      }));
      updatePendingUploads((current) => [...current, ...pending]);

      for (const [index, file] of uploadFiles.entries()) {
        const pendingId = pending[index].id;
        const form = new FormData();
        form.set("file", file);
        try {
          const response = await fetch(`/api/pages/${page.id}/attachments`, { method: "POST", body: form });
          const body = (await response.json().catch(() => null)) as { attachment?: Attachment } | null;
          if (!response.ok || !body?.attachment) {
            updatePendingUploads((current) =>
              current.map((upload) => upload.id === pendingId ? { ...upload, status: "failed" } : upload),
            );
            continue;
          }
          const attachment = body.attachment;
          updatePage(page.id, (current) => addAttachmentToPage(current, attachment));
          updatePendingUploads((current) => current.filter((upload) => upload.id !== pendingId));
        } catch {
          updatePendingUploads((current) =>
            current.map((upload) => upload.id === pendingId ? { ...upload, status: "failed" } : upload),
          );
        }
      }
    });
    if (mutation) await mutation;
  }

  async function deleteAttachment(attachment: Attachment) {
    if (!canEdit) return false;
    const mutation = runPageMutation(async () => {
      try {
        const response = await fetch(`/api/attachments/${attachment.id}`, { method: "DELETE" });
        const body = (await response.json().catch(() => null)) as { page?: PageEntry } | null;
        if (!response.ok) return false;
        const bodySave = removeAttachmentFromDraft(attachment.id, body?.page?.body);
        updatePage(page.id, (current) => {
          const authoritative = body?.page;
          if (!authoritative) return removeAttachmentFromPage(current, attachment);
          return {
            ...current,
            body: authoritative.body,
            bodyPreview: authoritative.bodyPreview,
            bodyLoaded: authoritative.bodyLoaded ?? current.bodyLoaded,
            attachments: authoritative.attachments,
            attachmentCount: authoritative.attachmentCount,
            attachmentBytes: authoritative.attachmentBytes,
            updatedAt: authoritative.updatedAt,
          };
        });
        await bodySave;
        return true;
      } catch {
        return false;
      }
    });
    return mutation ? await mutation : false;
  }

  async function uploadInlineFile(file: File, blockType: BlockType) {
    if (!canEdit) return null;
    const mutation = runPageMutation(async ({ canApplyEditorChange }) => {
      const form = new FormData();
      form.set("file", file);
      form.set("blockType", blockType);
      reportSaveStatus("Uploading");
      try {
        const response = await fetch(`/api/pages/${page.id}/attachments`, { method: "POST", body: form });
        const body = (await response.json().catch(() => null)) as { attachment?: Attachment } | null;
        const attachment = response.ok ? body?.attachment ?? null : null;
        reportSaveStatus(attachment ? "Uploaded" : "Upload failed", attachment ? { clearAfterMs: successStatusClearAfterMs } : {});
        if (!attachment) return null;
        updatePage(page.id, (current) => addAttachmentToPage(current, attachment));
        return canApplyEditorChange() ? attachment : null;
      } catch {
        reportSaveStatus("Upload failed");
        return null;
      }
    });
    return mutation ? await mutation : null;
  }

  function markInlineAttachmentInserted(attachment: Attachment, body: string) {
    if (!canEdit || !canApplyEditorMutation()) return;
    updatePage(page.id, (current) => markInlineAttachmentInsertedInPage(current, attachment, body));
  }

  return {
    pendingUploads,
    uploadAttachments,
    deleteAttachment,
    uploadInlineFile,
    markInlineAttachmentInserted,
  };
}
