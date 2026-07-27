import { useEffect, useState, useSyncExternalStore } from "react";
import type { PageUpdater } from "@/features/pages/workspacePageState";
import { normalizeTagList, tagListsEqual } from "@/lib/tags";
import type { PageEntry } from "@/lib/types";
import {
  getPageEditingSession,
  SUCCESS_STATUS_CLEAR_AFTER_MS,
  type PageContentPatch,
  type SaveStatusOptions,
} from "./pageEditingSession";

type UsePageEditorControllerOptions = {
  page: PageEntry;
  sessionScope: string;
  canEdit: boolean;
  canManageLock: boolean;
  updatePage: (pageId: string, updater: PageUpdater) => void;
};

export function usePageEditorController({
  page,
  sessionScope,
  canEdit,
  canManageLock,
  updatePage,
}: UsePageEditorControllerOptions) {
  const [session] = useState(() => getPageEditingSession(page, sessionScope));
  useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const locking = session.isLocking();
  const effectiveCanEdit = canEdit && !session.isReadOnly();

  useEffect(() => {
    session.setHost((patch) => {
      updatePage(session.pageId, (current) => ({ ...current, ...patch }));
    });
  }, [session, updatePage]);

  useEffect(() => {
    session.syncPage(page);
  }, [page, session]);

  useEffect(() => {
    return () => {
      void session.flush();
    };
  }, [session]);

  function patchSelectedPage(patch: Partial<PageEntry>) {
    if (!effectiveCanEdit) return;
    updatePage(page.id, (current) => ({ ...current, ...patch }));
  }

  function markBodyUnsaved(body: string) {
    if (!effectiveCanEdit) return;
    session.markBodyUnsaved(body);
  }

  function savePage(patch: PageContentPatch) {
    if (!canEdit) return Promise.resolve(false);
    return session.savePage(patch);
  }

  async function setPageTags(tags: string[]) {
    if (!effectiveCanEdit) return;
    const normalizedTags = normalizeTagList(tags);
    if (tagListsEqual(normalizedTags, normalizeTagList(page.tags))) return;
    await session.setTags(normalizedTags);
  }

  function setPageLocked(locked: boolean) {
    if (!canManageLock) return Promise.resolve();
    return session.setLocked(locked);
  }

  function reportSaveStatus(status: string, options: SaveStatusOptions = {}) {
    session.reportSaveStatus(status, options);
  }

  return {
    canEdit: effectiveCanEdit,
    locking,
    editorBody: session.editorBody(page.body),
    saving: session.visibleSaveStatus(),
    successStatusClearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS,
    reportSaveStatus,
    patchSelectedPage,
    markBodyUnsaved,
    savePage,
    setPageTags,
    setPageLocked,
    lockBlocked: session.isLockBlocked(),
    runExternalMutation: session.runExternalMutation,
    runEditorMutation: session.runEditorMutation,
    canApplyEditorMutation: session.canApplyEditorMutation,
    removeAttachmentFromDraft: session.removeAttachmentFromDraft,
  };
}
