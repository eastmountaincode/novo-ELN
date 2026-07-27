import { describe, expect, it } from "vitest";
import {
  createLatestMutationQueue,
  type LatestMutationQueue,
  type MutationResult,
} from "../src/features/editor/page/latestMutationQueue";
import {
  cancelPageEditingSessionsLogout,
  clearPageEditingSessionsForTests,
  createPageEditingSession,
  disposePageEditingSessions,
  getPageEditingSession,
  preparePageEditingSessionsForLogout,
  type PageContentPatch,
} from "../src/features/editor/page/pageEditingSession";
import { selectVisibleSaveStatus, type SaveStatusEntry } from "../src/features/editor/page/saveStatus";
import type { PageEntry } from "../src/lib/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function testPage(overrides: Partial<PageEntry> = {}): PageEntry {
  return {
    id: "page-1",
    notebookId: "notebook-1",
    title: "Page",
    body: "server body",
    status: "",
    ownerId: "user-1",
    ownerFirstName: "Test",
    ownerLastName: "User",
    lockedAt: "",
    lockedBy: "",
    lockedByFirstName: "",
    lockedByLastName: "",
    createdAt: "2026-07-27T18:00:00.000Z",
    updatedAt: "2026-07-27T18:00:00.000Z",
    tags: [],
    attachments: [],
    ...overrides,
  };
}

describe("latest mutation queue", () => {
  it("serializes requests and persists the newest queued value last", async () => {
    const requests: Array<{ value: string; request: ReturnType<typeof deferred<MutationResult>> }> = [];
    const successes: Array<{ value: string; hasNewerPending: boolean }> = [];
    const queue = createLatestMutationQueue<string>({
      mergePending: (_current, next) => next,
      persist: (value) => {
        const request = deferred<MutationResult>();
        requests.push({ value, request });
        return request.promise;
      },
      onSuccess: (value, _result, context) => successes.push({ value, hasNewerPending: context.hasNewerPending }),
    });

    const firstOutcome = queue.enqueue("body A");
    const latestOutcome = queue.enqueue("body B");
    expect(requests.map(({ value }) => value)).toEqual(["body A"]);

    requests[0].request.resolve({ ok: true, changed: true });
    await flushMicrotasks();
    expect(requests.map(({ value }) => value)).toEqual(["body A", "body B"]);

    requests[1].request.resolve({ ok: true, changed: true });
    await expect(firstOutcome).resolves.toBe(true);
    await expect(latestOutcome).resolves.toBe(true);
    expect(successes).toEqual([
      { value: "body A", hasNewerPending: true },
      { value: "body B", hasNewerPending: false },
    ]);
    expect(queue.hasPending()).toBe(false);
  });

  it("keeps a failed latest value retryable without rejecting the caller", async () => {
    let attempt = 0;
    const queue = createLatestMutationQueue<string>({
      mergePending: (_current, next) => next,
      persist: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("offline");
        return { ok: true };
      },
    });

    await expect(queue.enqueue("draft")).resolves.toBe(false);
    expect(queue.hasPending()).toBe(true);
    await expect(queue.flush()).resolves.toBe(true);
    expect(attempt).toBe(2);
    expect(queue.hasPending()).toBe(false);
  });

  it("continues with a newer pending value when an older request fails", async () => {
    const firstRequest = deferred<MutationResult>();
    const persisted: string[] = [];
    const queue = createLatestMutationQueue<string>({
      mergePending: (_current, next) => next,
      persist: async (value) => {
        persisted.push(value);
        if (value === "old") return firstRequest.promise;
        return { ok: true };
      },
    });

    const outcome = queue.enqueue("old");
    void queue.enqueue("new");
    firstRequest.reject(new Error("transient failure"));

    await expect(outcome).resolves.toBe(true);
    expect(persisted).toEqual(["old", "new"]);
    expect(queue.hasPending()).toBe(false);
  });

  it("merges pending metadata so no field change is dropped", async () => {
    const firstRequest = deferred<MutationResult>();
    const persisted: Array<{ title?: string; status?: string }> = [];
    const queue = createLatestMutationQueue<{ title?: string; status?: string }>({
      mergePending: (current, next) => ({ ...current, ...next }),
      persist: async (value) => {
        persisted.push(value);
        if (persisted.length === 1) return firstRequest.promise;
        return { ok: true };
      },
    });

    const outcome = queue.enqueue({ title: "First" });
    void queue.enqueue({ title: "Latest" });
    void queue.enqueue({ status: "Completed" });
    firstRequest.resolve({ ok: true });

    await expect(outcome).resolves.toBe(true);
    expect(persisted).toEqual([
      { title: "First" },
      { title: "Latest", status: "Completed" },
    ]);
  });

  it("merges a failed partial mutation back into a newer pending mutation", async () => {
    const firstRequest = deferred<MutationResult>();
    const persisted: Array<{ title?: string; status?: string }> = [];
    const queue = createLatestMutationQueue<{ title?: string; status?: string }>({
      mergePending: (current, next) => ({ ...current, ...next }),
      persist: async (value) => {
        persisted.push(value);
        if (persisted.length === 1) return firstRequest.promise;
        return { ok: true };
      },
    });

    const outcome = queue.enqueue({ status: "Completed" });
    void queue.enqueue({ title: "Latest title" });
    firstRequest.resolve({ ok: false, error: "temporary failure" });

    await expect(outcome).resolves.toBe(true);
    expect(persisted).toEqual([
      { status: "Completed" },
      { status: "Completed", title: "Latest title" },
    ]);
  });

  it("drains a mutation enqueued during the completion handoff", async () => {
    const persisted: string[] = [];
    let lateOutcome: Promise<boolean> | undefined;
    const queue: LatestMutationQueue<string> = createLatestMutationQueue<string>({
      mergePending: (_current, next) => next,
      persist: async (value) => {
        persisted.push(value);
        return { ok: true };
      },
      onSuccess: (value) => {
        if (value !== "first") return;
        queueMicrotask(() => {
          lateOutcome = queue.enqueue("late");
        });
      },
    });

    await expect(queue.enqueue("first")).resolves.toBe(true);
    await flushMicrotasks();
    await expect(lateOutcome).resolves.toBe(true);
    expect(persisted).toEqual(["first", "late"]);
    expect(queue.hasPending()).toBe(false);
  });
});

describe("page save status arbitration", () => {
  function entry(channel: SaveStatusEntry["channel"], message: string, sequence: number): SaveStatusEntry {
    return { channel, message, sequence };
  }

  it("keeps an unsaved body visible over unrelated successful work", () => {
    expect(selectVisibleSaveStatus([
      entry("body", "Unsaved", 1),
      entry("attachments", "Uploaded", 2),
      entry("tags", "Saved", 3),
    ])).toBe("Unsaved");
  });

  it("keeps failures visible over saves and in-progress work", () => {
    expect(selectVisibleSaveStatus([
      entry("tags", "Tag save failed", 1),
      entry("body", "Saved", 2),
      entry("attachments", "Uploading", 3),
    ])).toBe("Tag save failed");
  });

  it("uses the newest status when priorities are equal", () => {
    expect(selectVisibleSaveStatus([
      entry("body", "Saved", 4),
      entry("attachments", "Uploaded", 7),
    ])).toBe("Uploaded");
  });
});

describe("page editing session", () => {
  it("disables editing, flushes the latest body, and then locks", async () => {
    const requestOrder: string[] = [];
    const patches: Partial<PageEntry>[] = [];
    const lockedPage = testPage({
      id: "page-1",
      body: "final draft",
      lockedAt: "2026-07-27T18:00:00.000Z",
    });
    let lockingObserved = false;
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        waitForEditingToDisable: async () => {
          expect(lockingObserved).toBe(true);
          requestOrder.push("editing disabled");
        },
        patchPage: async (patch) => {
          requestOrder.push(`save ${patch.body}`);
          return { ok: true, changed: true };
        },
        setLocked: async () => {
          requestOrder.push("lock");
          return { ok: true, page: lockedPage };
        },
      },
    });
    session.subscribe(() => {
      lockingObserved = session.isLocking();
    });
    session.setHost((patch) => patches.push(patch));
    session.markBodyUnsaved("final draft");

    await session.setLocked(true);

    expect(requestOrder).toEqual(["editing disabled", "save final draft", "lock"]);
    expect(patches.at(-1)).toBe(lockedPage);
    expect(session.isLocking()).toBe(false);
  });

  it("waits for an existing external page mutation before locking", async () => {
    const externalRequest = deferred<void>();
    const requestOrder: string[] = [];
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        waitForEditingToDisable: async () => {},
        setLocked: async () => {
          requestOrder.push("lock");
          return { ok: true, page: testPage({ lockedAt: "2026-07-27T18:00:00.000Z" }) };
        },
      },
    });
    const mutation = session.runExternalMutation(async () => {
      requestOrder.push("mutation started");
      await externalRequest.promise;
      requestOrder.push("mutation finished");
    });

    const lock = session.setLocked(true);
    await flushMicrotasks();
    expect(requestOrder).toEqual(["mutation started"]);
    expect(session.runExternalMutation(async () => undefined)).toBeNull();

    externalRequest.resolve();
    await mutation;
    await lock;
    expect(requestOrder).toEqual(["mutation started", "mutation finished", "lock"]);
  });

  it("does not lock or finish logout flushing after an admitted page action fails", async () => {
    let lockRequests = 0;
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        waitForEditingToDisable: async () => {},
        setLocked: async () => {
          lockRequests += 1;
          return { ok: true, page: testPage({ lockedAt: "2026-07-27T18:00:00.000Z" }) };
        },
      },
    });
    const mutation = session.runExternalMutation(async () => {
      throw new Error("reply failed");
    });

    await expect(session.setLocked(true)).rejects.toThrow("Could not finish the current page action");
    await expect(mutation).rejects.toThrow("reply failed");
    expect(lockRequests).toBe(0);

    const secondMutation = session.runExternalMutation(async () => {
      throw new Error("upload failed");
    });
    expect(session.beginClose()).toBe(true);
    const flush = session.flush();
    await expect(secondMutation).rejects.toThrow("upload failed");
    await expect(flush).resolves.toEqual([false, true, true]);
  });

  it("remembers an admitted mutation failure that finishes during the pre-lock render", async () => {
    const editingDisabled = deferred<void>();
    const externalRequest = deferred<void>();
    let lockRequests = 0;
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        waitForEditingToDisable: () => editingDisabled.promise,
        setLocked: async () => {
          lockRequests += 1;
          return { ok: true, page: testPage({ lockedAt: "2026-07-27T18:00:00.000Z" }) };
        },
      },
    });
    const mutation = session.runExternalMutation(async () => externalRequest.promise);
    const lock = session.setLocked(true);

    externalRequest.reject(new Error("request failed during render"));
    await expect(mutation).rejects.toThrow("request failed during render");
    editingDisabled.resolve();

    await expect(lock).rejects.toThrow("Could not finish the current page action");
    expect(lockRequests).toBe(0);
  });

  it("blocks locking and logout while an editor transaction still needs the live editor", async () => {
    const editorRequest = deferred<void>();
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
    });
    const mutation = session.runEditorMutation(async () => {
      await editorRequest.promise;
    });
    await flushMicrotasks();

    expect(session.isLockBlocked()).toBe(true);
    expect(session.beginClose()).toBe(false);
    await expect(session.setLocked(true)).rejects.toThrow("Finish the current editor action");

    editorRequest.resolve();
    await mutation;
    expect(session.isLockBlocked()).toBe(false);
    expect(session.beginClose()).toBe(true);
  });

  it("does not lock when the pending body cannot be saved", async () => {
    let lockRequests = 0;
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        waitForEditingToDisable: async () => {},
        patchPage: async () => ({ ok: false, error: "offline" }),
        setLocked: async () => {
          lockRequests += 1;
          return { ok: false };
        },
      },
    });
    session.markBodyUnsaved("retryable draft");

    await expect(session.setLocked(true)).rejects.toThrow("Could not save the page before locking.");
    expect(lockRequests).toBe(0);
    expect(session.editorBody("server body")).toBe("retryable draft");
    expect(session.isLocking()).toBe(false);
  });

  it("preserves and retries failed body and metadata drafts after unlocking", async () => {
    let locked = true;
    const patches: PageContentPatch[] = [];
    const hostPatches: Partial<PageEntry>[] = [];
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        patchPage: async (patch) => {
          patches.push(patch);
          return locked ? { ok: false, error: "Page is locked." } : { ok: true, changed: true };
        },
        setLocked: async () => {
          locked = false;
          return {
            ok: true,
            page: testPage({ title: "server title", body: "server body", lockedAt: "" }),
          };
        },
      },
    });
    session.setHost((patch) => hostPatches.push(patch));
    session.markBodyUnsaved("local body");
    await expect(session.savePage({ body: "local body" })).resolves.toBe(false);
    await expect(session.savePage({ title: "local title" })).resolves.toBe(false);

    await session.setLocked(false);

    expect(patches.filter((patch) => patch.body !== undefined).at(-1)).toEqual({ body: "local body" });
    expect(patches.filter((patch) => patch.title !== undefined).at(-1)).toEqual({ title: "local title" });
    expect(hostPatches).toContainEqual(expect.objectContaining({
      body: "local body",
      title: "local title",
      lockedAt: "",
    }));
    expect(session.editorBody("local body")).toBe("local body");
    expect(session.bodyQueue.hasPending()).toBe(false);
    expect(session.metadataQueue.hasPending()).toBe(false);
  });

  it("keeps an in-flight optimistic tag visible across an unlock response", async () => {
    const tagRequest = deferred<MutationResult>();
    const hostPatches: Partial<PageEntry>[] = [];
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: ["server-tag"],
      requests: {
        patchTags: async () => tagRequest.promise,
        setLocked: async () => ({
          ok: true,
          page: testPage({ tags: ["server-tag"], lockedAt: "" }),
        }),
      },
    });
    session.setHost((patch) => hostPatches.push(patch));
    const tagSave = session.setTags(["optimistic-tag"]);
    hostPatches.length = 0;

    const unlock = session.setLocked(false);
    await flushMicrotasks();

    expect(hostPatches).toContainEqual(expect.objectContaining({ tags: ["optimistic-tag"] }));
    tagRequest.resolve({ ok: true, changed: true });
    await tagSave;
    await unlock;
    expect(session.tagQueue.hasPending()).toBe(false);
  });

  it("closes mutation intake while logout flushing and preserves a failed draft", async () => {
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: [],
      requests: {
        patchPage: async () => ({ ok: false, error: "offline" }),
      },
    });
    session.markBodyUnsaved("draft before logout");
    session.beginClose();

    session.markBodyUnsaved("late edit");
    expect(session.runExternalMutation(async () => undefined)).toBeNull();
    expect(await session.flush()).toEqual([false, true, true]);
    expect(session.editorBody("server body")).toBe("draft before logout");

    session.cancelClose();
    session.markBodyUnsaved("retryable draft");
    expect(session.editorBody("server body")).toBe("retryable draft");
  });

  it("rolls back only tags after a failed tag request and preserves a dirty body", async () => {
    const patches: Partial<PageEntry>[] = [];
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: ["persisted"],
      requests: {
        patchTags: async () => ({ ok: false, error: "offline" }),
      },
    });
    session.setHost((patch) => patches.push(patch));
    session.markBodyUnsaved("unsaved body");

    await expect(session.setTags(["optimistic"])).resolves.toBe(false);

    expect(patches).toEqual([
      { tags: ["optimistic"] },
      { tags: ["persisted"] },
    ]);
    expect(session.editorBody("server body")).toBe("unsaved body");
  });

  it("rolls back to the newest persisted tags when a later tag request fails", async () => {
    const firstRequest = deferred<MutationResult>();
    const patches: Partial<PageEntry>[] = [];
    let requestCount = 0;
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "server body",
      initialTags: ["original"],
      requests: {
        patchTags: async () => {
          requestCount += 1;
          if (requestCount === 1) return firstRequest.promise;
          return { ok: false, error: "offline" };
        },
      },
    });
    session.setHost((patch) => patches.push(patch));

    const outcome = session.setTags(["first saved"]);
    void session.setTags(["latest failed"]);
    firstRequest.resolve({ ok: true, changed: true });
    await outcome;

    expect(patches.at(-1)).toEqual({ tags: ["first saved"] });
  });

  it("removes a deleted attachment card from a dirty draft before saving", async () => {
    const persistedBodies: string[] = [];
    const body = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Keep this text" }] },
        { type: "attachmentCard", attrs: { attachmentId: "attachment-1", filename: "deleted.pdf" } },
      ],
    });
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: body,
      initialTags: [],
      requests: {
        patchPage: async (patch) => {
          if (patch.body !== undefined) persistedBodies.push(patch.body);
          return { ok: true, changed: true };
        },
      },
    });
    session.markBodyUnsaved(body);
    session.removeAttachmentFromDraft("attachment-1");
    await session.flush();

    expect(persistedBodies.at(-1)).toContain("Keep this text");
    expect(persistedBodies.at(-1)).not.toContain("attachment-1");
  });

  it("flushes a draft before adopting an authoritative comment-deletion body", async () => {
    const persistedBodies: string[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "persisted body",
      initialTags: [],
      requests: {
        patchPage: async (patch) => {
          if (patch.body !== undefined) persistedBodies.push(patch.body);
          return { ok: true, changed: true };
        },
      },
    });
    session.setHost((patch) => updates.push(patch));
    session.markBodyUnsaved("latest draft");

    const mutation = session.runEditorMutation(async ({ flushBody, adoptBody }) => {
      expect(await flushBody()).toBe(true);
      adoptBody("authoritative body without marker", "server timestamp");
    });
    await mutation;

    expect(persistedBodies).toEqual(["latest draft"]);
    expect(updates.at(-1)).toEqual({
      body: "authoritative body without marker",
      updatedAt: "server timestamp",
    });
    expect(session.editorBody("authoritative body without marker")).toBe("authoritative body without marker");
  });

  it("rejects outside body updates while an editor mutation owns the body queue", async () => {
    const persistedBodies: string[] = [];
    let releaseMutation: () => void = () => undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "persisted body",
      initialTags: [],
      requests: {
        patchPage: async (patch) => {
          if (patch.body !== undefined) persistedBodies.push(patch.body);
          return { ok: true, changed: true };
        },
      },
    });

    const mutation = session.runEditorMutation(async () => mutationGate);
    expect(session.runEditorMutation(async () => undefined)).toBeNull();
    session.markBodyUnsaved("blocked update");
    expect(await session.savePage({ body: "blocked save" })).toBe(false);
    releaseMutation();
    await mutation;
    await session.flush();

    expect(persistedBodies).toEqual([]);
  });

  it("uses the authoritative shared body when reconciling an attachment deletion without a local draft", async () => {
    const persistedBodies: string[] = [];
    const authoritativeBody = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Shared server edit" }] },
      ],
    });
    const session = createPageEditingSession({
      pageId: "page-1",
      initialBody: "older local body",
      initialTags: [],
      requests: {
        patchPage: async (patch) => {
          if (patch.body !== undefined) persistedBodies.push(patch.body);
          return { ok: true, changed: true };
        },
      },
    });

    session.removeAttachmentFromDraft("attachment-1", authoritativeBody);
    await session.flush();

    expect(persistedBodies).toEqual([]);
    expect(session.editorBody(authoritativeBody)).toContain("Shared server edit");
    expect(session.editorBody(authoritativeBody)).not.toContain("attachment-1");
  });

  it("reuses one session and queue set when the same page remounts", () => {
    clearPageEditingSessionsForTests();
    const page = testPage({
      id: "page-remount",
      body: "body",
    });

    expect(getPageEditingSession(page, "user-1")).toBe(getPageEditingSession(page, "user-1"));
  });

  it("isolates cached drafts by authenticated user", () => {
    clearPageEditingSessionsForTests();
    const page = testPage({ id: "shared-page", body: "server body" });
    const firstUserSession = getPageEditingSession(page, "user-1");
    const secondUserSession = getPageEditingSession(page, "user-2");
    firstUserSession.markBodyUnsaved("first user's private draft");

    expect(secondUserSession).not.toBe(firstUserSession);
    expect(secondUserSession.editorBody(page.body)).toBe("server body");
  });

  it("keeps prepared sessions recoverable until logout is confirmed", async () => {
    clearPageEditingSessionsForTests();
    const page = testPage({ id: "logout-page", body: "server body" });
    const session = getPageEditingSession(page, "logout-user");

    await expect(preparePageEditingSessionsForLogout("logout-user")).resolves.toBe(true);
    expect(getPageEditingSession(page, "logout-user")).toBe(session);
    const newlyVisitedPage = testPage({ id: "new-page-during-logout", body: "new server body" });
    const newlyVisitedSession = getPageEditingSession(newlyVisitedPage, "logout-user");
    newlyVisitedSession.markBodyUnsaved("must be ignored while logout is pending");
    expect(newlyVisitedSession.editorBody(newlyVisitedPage.body)).toBe("new server body");
    session.markBodyUnsaved("ignored while closing");
    expect(session.editorBody(page.body)).toBe("server body");

    cancelPageEditingSessionsLogout("logout-user");
    newlyVisitedSession.markBodyUnsaved("editing restored");
    expect(newlyVisitedSession.editorBody(newlyVisitedPage.body)).toBe("editing restored");
    session.markBodyUnsaved("draft after failed logout");
    expect(session.editorBody(page.body)).toBe("draft after failed logout");

    disposePageEditingSessions("logout-user");
    expect(getPageEditingSession(page, "logout-user")).not.toBe(session);
    clearPageEditingSessionsForTests();
  });
});
