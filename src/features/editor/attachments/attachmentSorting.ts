import { readStoredSortKey, timestampForSort } from "../../../lib/clientSorting";
import type { Attachment } from "../../../lib/types";

export type AttachmentSortKey = "created" | "title";

export const ATTACHMENT_SORT_OPTIONS: Array<{ key: AttachmentSortKey; label: string }> = [
  { key: "created", label: "Date created" },
  { key: "title", label: "Title" },
];

export const ATTACHMENT_SORT_STORAGE_KEY = "novo.attachmentSortKey";

export function readStoredAttachmentSortKey() {
  return readStoredSortKey(ATTACHMENT_SORT_STORAGE_KEY, ATTACHMENT_SORT_OPTIONS, "created");
}

export function sortAttachments(attachments: Attachment[], sortKey: AttachmentSortKey) {
  return attachments
    .map((attachment, index) => ({ attachment, index }))
    .sort((left, right) => {
      if (sortKey === "title") {
        const titleCompare = left.attachment.originalName.localeCompare(
          right.attachment.originalName,
          undefined,
          { sensitivity: "base", numeric: true },
        );
        return titleCompare || left.index - right.index;
      }

      const leftTimestamp = timestampForSort(left.attachment.createdAt);
      const rightTimestamp = timestampForSort(right.attachment.createdAt);
      return rightTimestamp - leftTimestamp || left.index - right.index;
    })
    .map(({ attachment }) => attachment);
}
