import { bodyToEditorText, removeAttachmentCardsFromBody } from "../../../lib/editor";
import type { Attachment, PageEntry } from "../../../lib/types";

export function addAttachmentToPage(page: PageEntry, attachment: Attachment): PageEntry {
  if (page.attachments.some((candidate) => candidate.id === attachment.id)) return page;
  return {
    ...page,
    attachments: [attachment, ...page.attachments],
    attachmentCount: (page.attachmentCount ?? page.attachments.length) + 1,
    attachmentBytes: (page.attachmentBytes ?? page.attachments.reduce((total, candidate) => total + candidate.size, 0)) + attachment.size,
    updatedAt: "Just now",
  };
}

export function removeAttachmentFromPage(page: PageEntry, attachment: Attachment): PageEntry {
  const attachmentExists = page.attachments.some((candidate) => candidate.id === attachment.id);
  const nextBody = removeAttachmentCardsFromBody(page.body, attachment.id);
  if (!attachmentExists && nextBody === page.body) return page;
  return {
    ...page,
    body: nextBody,
    bodyPreview: page.bodyLoaded ? bodyToEditorText(nextBody) : page.bodyPreview,
    attachments: page.attachments.filter((candidate) => candidate.id !== attachment.id),
    attachmentCount: Math.max(0, (page.attachmentCount ?? page.attachments.length) - (attachmentExists ? 1 : 0)),
    attachmentBytes: Math.max(0, (page.attachmentBytes ?? page.attachments.reduce((total, candidate) => total + candidate.size, 0)) - (attachmentExists ? attachment.size : 0)),
    updatedAt: "Just now",
  };
}

export function markInlineAttachmentInsertedInPage(page: PageEntry, attachment: Attachment, body: string): PageEntry {
  const pageWithAttachment = addAttachmentToPage(page, attachment);
  return {
    ...pageWithAttachment,
    body,
    bodyLoaded: true,
    bodyPreview: bodyToEditorText(body),
    updatedAt: "Just now",
  };
}
