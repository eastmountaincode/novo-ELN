import { removeAttachmentCardsFromBody } from "../../../lib/editor";
import type { PageEntry, PageStatus } from "@/lib/types";
import {
  createLatestMutationQueue,
  type LatestMutationQueue,
  type MutationResult,
} from "./latestMutationQueue";
import {
  selectVisibleSaveStatus,
  type SaveStatusChannel,
  type SaveStatusEntry,
} from "./saveStatus";

export const SUCCESS_STATUS_CLEAR_AFTER_MS = 4400;

export type SaveStatusOptions = {
  clearAfterMs?: number;
};

export type PageContentPatch = {
  title?: string;
  body?: string;
  status?: PageStatus;
};

export type ExternalMutationContext = {
  canApplyEditorChange: () => boolean;
  saveBody: (body: string) => Promise<boolean>;
  flushBody: () => Promise<boolean>;
  adoptBody: (body: string, updatedAt?: string) => void;
};

type PageEditingRequests = {
  patchPage: (patch: PageContentPatch) => Promise<MutationResult>;
  patchTags: (tags: string[]) => Promise<MutationResult>;
  setLocked: (locked: boolean) => Promise<{ ok: boolean; page?: PageEntry; error?: string }>;
  waitForEditingToDisable: () => Promise<void>;
};

type PageEditingSessionOptions = {
  pageId: string;
  initialBody: string;
  initialTags: string[];
  requests?: Partial<PageEditingRequests>;
};

export type PageEditingSession = ReturnType<typeof createPageEditingSession>;

const sessions = new Map<string, PageEditingSession>();
const closingScopes = new Set<string>();
const retiringSessionKeys = new Set<string>();

function defaultRequests(pageId: string): PageEditingRequests {
  return {
    patchPage: async (patch) => {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = (await response.json().catch(() => null)) as { changed?: boolean; error?: string } | null;
      return { ok: response.ok, changed: result?.changed, error: result?.error };
    },
    patchTags: async (tags) => {
      const response = await fetch(`/api/pages/${pageId}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      const result = (await response.json().catch(() => null)) as { changed?: boolean; error?: string } | null;
      return { ok: response.ok, changed: result?.changed, error: result?.error };
    },
    setLocked: async (locked) => {
      const response = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked }),
      });
      const result = (await response.json().catch(() => null)) as { page?: PageEntry; error?: string } | null;
      return { ok: response.ok, page: result?.page, error: result?.error };
    },
    waitForEditingToDisable: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  };
}

export function createPageEditingSession({
  pageId,
  initialBody,
  initialTags,
  requests: requestOverrides = {},
}: PageEditingSessionOptions) {
  const requests = { ...defaultRequests(pageId), ...requestOverrides };
  const listeners = new Set<() => void>();
  const statusEntries = new Map<SaveStatusChannel, SaveStatusEntry>();
  const statusTimers = new Map<SaveStatusChannel, ReturnType<typeof setTimeout>>();
  const externalMutations = new Set<Promise<unknown>>();
  const editorMutations = new Set<Promise<unknown>>();
  let externalFailureSequence = 0;
  let statusSequence = 0;
  let revision = 0;
  let updatePage: (patch: Partial<PageEntry>) => void = () => undefined;
  let latestBodyDraft = initialBody;
  let dirtyBody: string | null = null;
  let latestMetadataDraft: Omit<PageContentPatch, "body"> = {};
  let persistedTags = [...initialTags];
  let latestTagDraft: string[] | null = null;
  let locking = false;
  let lockBarrierClosed = false;
  let lockPromise: Promise<void> | null = null;
  let closing = false;
  let disposed = false;

  function notify() {
    revision += 1;
    for (const listener of listeners) listener();
  }

  function setStatus(channel: SaveStatusChannel, message: string, options: SaveStatusOptions = {}) {
    if (disposed) return;
    const existingTimer = statusTimers.get(channel);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      statusTimers.delete(channel);
    }
    statusSequence += 1;
    const sequence = statusSequence;
    if (message) statusEntries.set(channel, { channel, message, sequence });
    else statusEntries.delete(channel);
    notify();

    if (!message || !options.clearAfterMs) return;
    const timer = setTimeout(() => {
      const current = statusEntries.get(channel);
      if (current?.sequence === sequence) statusEntries.delete(channel);
      statusTimers.delete(channel);
      notify();
    }, options.clearAfterMs);
    statusTimers.set(channel, timer);
  }

  const bodyQueue = createLatestMutationQueue<string>({
    mergePending: (_current, next) => next,
    persist: (body) => requests.patchPage({ body }),
    onStart: () => setStatus("body", "Saving..."),
    onSuccess: (body, result) => {
      if (latestBodyDraft !== body) return;
      updatePage(result.changed ? { body, updatedAt: "Just now" } : { body });
      dirtyBody = null;
      setStatus("body", "Saved", { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS });
    },
    onFailure: () => setStatus("body", "Save failed"),
  });

  const metadataQueue = createLatestMutationQueue<Omit<PageContentPatch, "body">>({
    mergePending: (current, next) => ({ ...current, ...next }),
    persist: requests.patchPage,
    onStart: () => setStatus("metadata", "Saving..."),
    onSuccess: (_patch, result, context) => {
      if (context.hasNewerPending) return;
      latestMetadataDraft = {};
      if (result.changed) updatePage({ updatedAt: "Just now" });
      setStatus("metadata", result.changed ? "Saved" : "", result.changed ? { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS } : {});
    },
    onFailure: () => setStatus("metadata", "Save failed"),
  });

  const tagQueue = createLatestMutationQueue<string[]>({
    mergePending: (_current, next) => next,
    preserveLatestOnFailure: false,
    persist: requests.patchTags,
    onStart: () => setStatus("tags", "Saving..."),
    onSuccess: (tags, result, context) => {
      persistedTags = [...tags];
      if (context.hasNewerPending) return;
      latestTagDraft = null;
      if (result.changed) updatePage({ updatedAt: "Just now" });
      setStatus("tags", "Saved", { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS });
    },
    onFailure: (_tags, _result, context) => {
      if (context.hasNewerPending) return;
      latestTagDraft = null;
      updatePage({ tags: [...persistedTags] });
      setStatus("tags", "Tag save failed");
    },
  });

  function markBodyUnsaved(body: string) {
    if (disposed || closing || lockBarrierClosed || editorMutations.size > 0) return;
    latestBodyDraft = body;
    dirtyBody = body;
    setStatus("body", "Unsaved");
  }

  function savePage(patch: PageContentPatch) {
    if (disposed || closing || lockBarrierClosed) return Promise.resolve(false);
    if (Object.prototype.hasOwnProperty.call(patch, "body")) {
      if (editorMutations.size > 0) return Promise.resolve(false);
      const body = patch.body ?? "";
      if (dirtyBody === null) {
        latestBodyDraft = body;
        dirtyBody = body;
      }
      return bodyQueue.enqueue(body);
    }
    const metadataPatch = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    latestMetadataDraft = { ...latestMetadataDraft, ...metadataPatch };
    return metadataQueue.enqueue(metadataPatch);
  }

  function setTags(tags: string[]) {
    if (disposed || closing || lockBarrierClosed) return Promise.resolve(false);
    latestTagDraft = [...tags];
    updatePage({ tags });
    return tagQueue.enqueue(tags);
  }

  function canApplyEditorMutation() {
    return !disposed && !closing && !locking;
  }

  function canStartEditorMutation() {
    return canApplyEditorMutation() && editorMutations.size === 0;
  }

  function saveBodyForTrackedMutation(body: string) {
    if (disposed) return Promise.resolve(false);
    latestBodyDraft = body;
    dirtyBody = body;
    return bodyQueue.enqueue(body);
  }

  function flushBodyForTrackedMutation() {
    if (disposed) return Promise.resolve(false);
    if (dirtyBody !== null) void bodyQueue.enqueue(dirtyBody);
    return bodyQueue.flush();
  }

  function adoptBodyForTrackedMutation(body: string, updatedAt?: string) {
    if (disposed) return;
    latestBodyDraft = body;
    dirtyBody = null;
    updatePage({ body, ...(updatedAt ? { updatedAt } : {}) });
    setStatus("body", "Saved", { clearAfterMs: SUCCESS_STATUS_CLEAR_AFTER_MS });
  }

  function runTrackedMutation<T>(
    operation: (context: ExternalMutationContext) => Promise<T>,
    requiresEditor: boolean,
  ): Promise<T> | null {
    if (requiresEditor ? !canStartEditorMutation() : !canApplyEditorMutation()) return null;
    const mutation = Promise.resolve().then(() => operation({
      canApplyEditorChange: canApplyEditorMutation,
      saveBody: saveBodyForTrackedMutation,
      flushBody: flushBodyForTrackedMutation,
      adoptBody: adoptBodyForTrackedMutation,
    }));
    externalMutations.add(mutation);
    if (requiresEditor) editorMutations.add(mutation);
    notify();
    void mutation.then(() => {
      externalMutations.delete(mutation);
      editorMutations.delete(mutation);
      notify();
    }, () => {
      externalFailureSequence += 1;
      externalMutations.delete(mutation);
      editorMutations.delete(mutation);
      notify();
    });
    return mutation;
  }

  function runExternalMutation<T>(
    operation: (context: ExternalMutationContext) => Promise<T>,
  ) {
    return runTrackedMutation(operation, false);
  }

  function runEditorMutation<T>(
    operation: (context: ExternalMutationContext) => Promise<T>,
  ) {
    return runTrackedMutation(operation, true);
  }

  async function waitForExternalMutations(failureSequenceAtStart = externalFailureSequence) {
    let succeeded = true;
    while (externalMutations.size > 0) {
      const results = await Promise.allSettled([...externalMutations]);
      if (results.some((result) => result.status === "rejected")) succeeded = false;
    }
    return succeeded && externalFailureSequence === failureSequenceAtStart;
  }

  function removeAttachmentFromDraft(attachmentId: string, authoritativeBody?: string) {
    if (disposed) return Promise.resolve(false);
    const hasLocalDraft = dirtyBody !== null || bodyQueue.hasPending();
    const baseBody = hasLocalDraft ? latestBodyDraft : authoritativeBody ?? latestBodyDraft;
    const nextBody = removeAttachmentCardsFromBody(baseBody, attachmentId);
    latestBodyDraft = nextBody;
    if (!hasLocalDraft) {
      dirtyBody = null;
      notify();
      return Promise.resolve(true);
    }
    dirtyBody = nextBody;
    const save = bodyQueue.enqueue(nextBody);
    notify();
    return save;
  }

  async function runSetLocked(locked: boolean) {
    if (disposed) throw new Error("Page editing session is no longer active.");
    locking = true;
    lockBarrierClosed = false;
    const externalFailureSequenceAtStart = externalFailureSequence;
    notify();
    try {
      if (locked) {
        await requests.waitForEditingToDisable();
        lockBarrierClosed = true;
        const externalMutationsSucceeded = await waitForExternalMutations(externalFailureSequenceAtStart);
        if (!externalMutationsSucceeded) {
          throw new Error("Could not finish the current page action before locking.");
        }
        if (dirtyBody !== null) void bodyQueue.enqueue(dirtyBody);
        const savesSucceeded = (await Promise.all([
          bodyQueue.flush(),
          metadataQueue.flush(),
          tagQueue.flush(),
        ])).every(Boolean);
        if (!savesSucceeded) throw new Error("Could not save the page before locking.");
      }

      const preserveBodyDraft = !locked && (dirtyBody !== null || bodyQueue.hasPending());
      const preservedBody = latestBodyDraft;
      const preserveMetadataDraft = !locked && metadataQueue.hasPending();
      const preservedMetadata = { ...latestMetadataDraft };
      const preservedTagDraft = !locked && latestTagDraft ? [...latestTagDraft] : null;
      const result = await requests.setLocked(locked);
      if (!result.ok || !result.page) throw new Error(result.error || "Could not update page lock.");
      const tagRequestStillPending = Boolean(preservedTagDraft && tagQueue.hasPending());
      const tagRequestSucceededWhileUnlocking = Boolean(
        preservedTagDraft
        && !tagRequestStillPending
        && persistedTags.length === preservedTagDraft.length
        && persistedTags.every((tag, index) => tag === preservedTagDraft[index]),
      );
      const preserveTagDraft = tagRequestStillPending || tagRequestSucceededWhileUnlocking;
      persistedTags = tagRequestSucceededWhileUnlocking && preservedTagDraft
        ? [...preservedTagDraft]
        : [...result.page.tags];
      if (preserveBodyDraft) {
        latestBodyDraft = preservedBody;
        dirtyBody = preservedBody;
      } else {
        latestBodyDraft = result.page.body;
        dirtyBody = null;
      }
      if (locked) {
        updatePage(result.page);
      } else {
        updatePage({
          ...result.page,
          ...(preserveBodyDraft ? { body: preservedBody } : {}),
          ...(preserveMetadataDraft ? preservedMetadata : {}),
          ...(preserveTagDraft && preservedTagDraft ? { tags: preservedTagDraft } : {}),
        });
      }
      if (!locked) {
        const retryAfterUnlock = async <T,>(queue: LatestMutationQueue<T>) => {
          if (await queue.flush()) return;
          if (queue.hasPending()) await queue.flush();
        };
        await Promise.all([
          ...(preserveBodyDraft ? [retryAfterUnlock(bodyQueue)] : []),
          ...(preserveMetadataDraft ? [retryAfterUnlock(metadataQueue)] : []),
          ...(preserveTagDraft ? [retryAfterUnlock(tagQueue)] : []),
        ]);
      }
    } finally {
      lockBarrierClosed = false;
      locking = false;
      notify();
    }
  }

  function setLocked(locked: boolean) {
    if (closing) return Promise.reject(new Error("Page editing session is closing."));
    if (locked && editorMutations.size > 0) {
      return Promise.reject(new Error("Finish the current editor action before locking."));
    }
    if (lockPromise) return lockPromise;
    lockPromise = runSetLocked(locked).finally(() => {
      lockPromise = null;
    });
    return lockPromise;
  }

  return {
    pageId,
    bodyQueue,
    metadataQueue,
    tagQueue,
    markBodyUnsaved,
    savePage,
    setTags,
    setLocked,
    runExternalMutation,
    runEditorMutation,
    canApplyEditorMutation,
    removeAttachmentFromDraft,
    setHost(updater: (patch: Partial<PageEntry>) => void) {
      if (disposed) return;
      updatePage = updater;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return revision;
    },
    syncPage(page: PageEntry) {
      if (disposed) return;
      if (dirtyBody === null && !bodyQueue.hasPending()) latestBodyDraft = page.body;
      if (!tagQueue.hasPending()) persistedTags = [...page.tags];
    },
    reportSaveStatus(status: string, options: SaveStatusOptions = {}) {
      setStatus("attachments", status, options);
    },
    visibleSaveStatus() {
      return selectVisibleSaveStatus([...statusEntries.values()]);
    },
    editorBody(serverBody: string) {
      return dirtyBody !== null || bodyQueue.hasPending() ? latestBodyDraft : serverBody;
    },
    isLocking() {
      return locking;
    },
    isReadOnly() {
      return locking || closing;
    },
    isLockBlocked() {
      return editorMutations.size > 0;
    },
    beginClose() {
      if (disposed || editorMutations.size > 0) return false;
      closing = true;
      lockBarrierClosed = true;
      notify();
      return true;
    },
    cancelClose() {
      if (disposed) return;
      closing = false;
      lockBarrierClosed = false;
      notify();
    },
    async flush() {
      if (disposed) return [false, false, false];
      if (lockPromise) {
        try {
          await lockPromise;
        } catch {
          return [false, false, false];
        }
      }
      const externalMutationsSucceeded = await waitForExternalMutations();
      if (dirtyBody !== null) void bodyQueue.enqueue(dirtyBody);
      const results = await Promise.all([bodyQueue.flush(), metadataQueue.flush(), tagQueue.flush()]);
      if (!externalMutationsSucceeded) results[0] = false;
      return results;
    },
    dispose() {
      disposed = true;
      closing = true;
      updatePage = () => undefined;
      for (const timer of statusTimers.values()) clearTimeout(timer);
      statusTimers.clear();
      statusEntries.clear();
      listeners.clear();
    },
  };
}

function sessionKey(scopeId: string, pageId: string) {
  return `${scopeId}:${pageId}`;
}

export function getPageEditingSession(page: PageEntry, scopeId: string) {
  const key = sessionKey(scopeId, page.id);
  const existing = sessions.get(key);
  if (existing) return existing;
  const session = createPageEditingSession({
    pageId: page.id,
    initialBody: page.body,
    initialTags: page.tags,
  });
  if (closingScopes.has(scopeId) || retiringSessionKeys.has(key)) session.beginClose();
  sessions.set(key, session);
  return session;
}

function getScopedSessions(scopeId: string) {
  const prefix = `${scopeId}:`;
  return [...sessions.entries()].filter(([key]) => key.startsWith(prefix));
}

export async function preparePageEditingSessionsForLogout(scopeId: string) {
  closingScopes.add(scopeId);
  const scopedSessions = getScopedSessions(scopeId);
  const closingSessions: PageEditingSession[] = [];
  for (const [, session] of scopedSessions) {
    if (!session.beginClose()) {
      for (const closingSession of closingSessions) closingSession.cancelClose();
      closingScopes.delete(scopeId);
      return false;
    }
    closingSessions.push(session);
  }
  const results = await Promise.all(scopedSessions.map(([, session]) => session.flush()));
  const succeeded = results.every((result) => result.every(Boolean));
  if (!succeeded) {
    for (const [, session] of scopedSessions) session.cancelClose();
    closingScopes.delete(scopeId);
    return false;
  }
  return true;
}

export function cancelPageEditingSessionsLogout(scopeId: string) {
  closingScopes.delete(scopeId);
  for (const [, session] of getScopedSessions(scopeId)) session.cancelClose();
}

export function disposePageEditingSessions(scopeId: string) {
  closingScopes.delete(scopeId);
  for (const [key, session] of getScopedSessions(scopeId)) {
    session.dispose();
    sessions.delete(key);
  }
}

function removalKeys(scopeId: string, pageIds: string[]) {
  return [...new Set(pageIds)].map((pageId) => sessionKey(scopeId, pageId));
}

export async function preparePageEditingSessionsForRemoval(scopeId: string, pageIds: string[]) {
  const keys = removalKeys(scopeId, pageIds);
  for (const key of keys) retiringSessionKeys.add(key);
  const preparedSessions: PageEditingSession[] = [];
  for (const key of keys) {
    const session = sessions.get(key);
    if (!session) continue;
    if (!session.beginClose()) {
      for (const prepared of preparedSessions) prepared.cancelClose();
      for (const retiringKey of keys) retiringSessionKeys.delete(retiringKey);
      return false;
    }
    preparedSessions.push(session);
  }
  const results = await Promise.all(preparedSessions.map((session) => session.flush()));
  if (results.every((result) => result.every(Boolean))) return true;
  for (const session of preparedSessions) session.cancelClose();
  for (const key of keys) retiringSessionKeys.delete(key);
  return false;
}

export function cancelPageEditingSessionsRemoval(scopeId: string, pageIds: string[]) {
  for (const key of removalKeys(scopeId, pageIds)) {
    retiringSessionKeys.delete(key);
    sessions.get(key)?.cancelClose();
  }
}

export function disposeRemovedPageEditingSessions(scopeId: string, pageIds: string[]) {
  for (const key of removalKeys(scopeId, pageIds)) {
    retiringSessionKeys.delete(key);
    sessions.get(key)?.dispose();
    sessions.delete(key);
  }
}

export function clearPageEditingSessionsForTests() {
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  closingScopes.clear();
  retiringSessionKeys.clear();
}
