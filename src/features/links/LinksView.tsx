"use client";

import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpDown, Check, Copy, ExternalLink, GripVertical, Link as LinkIcon, Pencil, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SharedLink } from "@/lib/sharedLinkTypes";

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(response.status === 401 ? "Your session has expired. Reload the page to sign in." : body?.error || "Unable to load links. Please try again.");
  }
  if (!body) throw new Error("Unable to load links. Please try again.");
  return body as T;
}

export function LinksView() {
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [links, setLinks] = useState<SharedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<SharedLink | "new" | null>(null);
  const [deleting, setDeleting] = useState<SharedLink | null>(null);
  const [originalLinks, setOriginalLinks] = useState<SharedLink[] | null>(null);
  const reordering = originalLinks !== null;
  const orderChanged = originalLinks !== null && links.some((link, index) => link.id !== originalLinks[index]?.id);
  const [savingOrder, setSavingOrder] = useState(false);
  const savingOrderRef = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeLink = links.find((link) => link.id === activeId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/links", { cache: "no-store", signal: controller.signal })
      .then((response) => readResponse<{ links: SharedLink[] }>(response))
      .then((body) => {
        if (!controller.signal.aborted) setLinks(body.links);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load links.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function finishDrag({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over || active.id === over.id || savingOrderRef.current) return;
    const from = links.findIndex((link) => link.id === active.id);
    const to = links.findIndex((link) => link.id === over.id);
    if (from < 0 || to < 0) return;
    setLinks(arrayMove(links, from, to));
  }

  async function saveOrder() {
    if (savingOrderRef.current || !orderChanged) return;
    savingOrderRef.current = true;
    setSavingOrder(true);
    setError("");
    try {
      const body = await readResponse<{ links: SharedLink[] }>(await fetch("/api/links/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: links.map((link) => link.id) }),
      }));
      setLinks(body.links);
      setOriginalLinks(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save the order. Please try again.");
    } finally {
      savingOrderRef.current = false;
      setSavingOrder(false);
    }
  }

  return (
    <section className="min-h-0 overflow-y-auto scroll-contained [scrollbar-gutter:stable] bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-950">Links</h1>
          <div className="flex items-center gap-2">
            {reordering ? <>
              <button type="button" disabled={savingOrder || activeId !== null} onClick={() => { setLinks(originalLinks); setOriginalLinks(null); setError(""); }} className="inline-flex h-8 items-center px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={!orderChanged || savingOrder || activeId !== null} onClick={() => void saveOrder()} className="inline-flex h-8 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"><Check size={16} />{savingOrder ? "Saving…" : "Save"}</button>
            </> : <button type="button" disabled={loading || links.length < 2} onClick={() => { setOriginalLinks(links); setError(""); }} className="inline-flex h-8 items-center gap-2 px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:opacity-50"><ArrowUpDown size={16} />Reorder</button>}
            <button ref={addButtonRef} type="button" disabled={loading || reordering} onClick={() => setEditing("new")} className="inline-flex h-8 shrink-0 items-center gap-2 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              <Plus size={16} />Add link
            </button>
          </div>
        </div>
        {error ? <p role="alert" className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {loading ? <p role="status" className="text-sm text-slate-500">Loading links…</p> : links.length === 0 && !error ? (
          <div className="border border-slate-200 px-6 py-12 text-center">
            <LinkIcon size={24} className="mx-auto mb-3 text-slate-400" />
            <h2 className="font-medium text-slate-950">No links</h2>
          </div>
        ) : (
          <DndContext id="shared-links" sensors={sensors} collisionDetection={closestCenter} onDragStart={({ active }) => setActiveId(String(active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={finishDrag}>
            <SortableContext items={links.map((link) => link.id)} strategy={verticalListSortingStrategy}>
              <ul aria-label="Links" aria-busy={savingOrder} className="divide-y divide-slate-200 border border-slate-200">
                {links.map((link) => <SortableLinkRow key={link.id} link={link} reordering={reordering} saving={savingOrder} onEdit={() => setEditing(link)} onDelete={() => setDeleting(link)} />)}
              </ul>
            </SortableContext>
            <DragOverlay>
              {activeLink ? <div inert className="border border-slate-300 bg-white shadow-lg"><LinkRowContent link={activeLink} handle={<span className="grid size-8 shrink-0 place-items-center text-slate-500"><GripVertical size={16} /></span>} /></div> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      {editing !== null ? <LinkForm key={editing === "new" ? "new" : editing.id} link={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(link) => { setLinks((current) => current.some((item) => item.id === link.id) ? current.map((item) => item.id === link.id ? link : item) : [...current, link]); setError(""); setEditing(null); }} /> : null}
      {deleting ? <DeleteLinkDialog link={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setLinks((current) => current.filter((link) => link.id !== deleting.id)); setError(""); setDeleting(null); addButtonRef.current?.focus(); }} /> : null}
    </section>
  );
}

function SortableLinkRow({ link, reordering, saving, onEdit, onDelete }: { link: SharedLink; reordering: boolean; saving: boolean; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: link.id, disabled: !reordering || saving });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : undefined }} className="bg-white motion-reduce:!transition-none">
      <LinkRowContent link={link} handle={reordering ? <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={saving} aria-label={`Reorder ${link.title}`} className="grid size-8 shrink-0 touch-none place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 enabled:cursor-grab enabled:active:cursor-grabbing disabled:opacity-50"><GripVertical size={16} /></button> : undefined} actions={!reordering ? <div className="flex shrink-0 gap-1">
        <button type="button" onClick={onEdit} aria-label={`Edit ${link.title}`} title="Edit link" className="grid size-8 place-items-center text-slate-500 hover:bg-slate-100 hover:text-slate-950"><Pencil size={16} /></button>
        <button type="button" onClick={onDelete} aria-label={`Delete ${link.title}`} title="Delete link" className="grid size-8 place-items-center text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>
      </div> : undefined} />
    </li>
  );
}

function LinkRowContent({ link, handle, actions }: { link: SharedLink; handle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4">
      {handle}
      <LinkFavicon key={link.url} id={link.id} />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-5">
        <div className="min-w-0">
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-baseline gap-2 font-semibold text-slate-950 hover:underline">
            <span className="break-words [overflow-wrap:anywhere]">{link.title}</span><ExternalLink size={14} className="shrink-0 self-center" aria-label="Opens in a new tab" />
          </a>
          {link.description ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600 [overflow-wrap:anywhere]">{link.description}</p> : null}
          <LinkUrl key={link.url} url={link.url} title={link.title} />
        </div>
        {actions}
      </div>
    </div>
  );
}

function LinkFavicon({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span aria-hidden="true" className="mr-2 grid size-12 shrink-0 self-center place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-400">
      {!loaded || failed ? <LinkIcon size={18} className="col-start-1 row-start-1" /> : null}
      {!failed ? <Image src={`/api/links/${encodeURIComponent(id)}/favicon`} alt="" width={24} height={24} unoptimized draggable={false} referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className={`col-start-1 row-start-1 size-6 object-contain ${loaded ? "" : "invisible"}`} /> : null}
    </span>
  );
}

function LinkUrl({ url, title }: { url: string; title: string }) {
  const tooltipId = useId();
  const [hintOpen, setHintOpen] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (feedback !== "copied") return;
    const timeout = window.setTimeout(() => setFeedback("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  async function copy() {
    setFeedback("idle");
    try {
      await navigator.clipboard.writeText(url);
      setFeedback("copied");
    } catch {
      setFeedback("error");
    }
  }

  const showHint = hintOpen || feedback === "copied";

  return (
    <>
      <div className="mt-1 flex h-5 min-w-0 items-center gap-1">
        <p className="truncate text-sm text-slate-500" title={url}>{url}</p>
        <span className="relative shrink-0" onPointerEnter={() => setHintOpen(true)} onPointerLeave={() => setHintOpen(false)}>
          <button type="button" onClick={() => void copy()} onFocus={() => setHintOpen(true)} onBlur={() => setHintOpen(false)} onKeyDown={(event) => { if (event.key === "Escape") { setHintOpen(false); setFeedback("idle"); } }} aria-label={`Copy URL for ${title}`} aria-describedby={showHint ? tooltipId : undefined} className="grid size-6 place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:text-slate-700">
            {feedback === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
          {showHint ? <span id={tooltipId} role="tooltip" className="absolute bottom-full left-1/2 z-10 -translate-x-1/2 whitespace-nowrap pb-1"><span className="block bg-slate-950 px-2 py-1 text-xs text-white shadow-sm">{feedback === "copied" ? "Copied" : "Copy URL"}</span></span> : null}
        </span>
        <span role="status" className="sr-only">{feedback === "copied" ? "URL copied" : ""}</span>
      </div>
      {feedback === "error" ? <p role="alert" className="mt-1 text-xs text-red-700">Unable to copy. Select the URL to copy it.</p> : null}
    </>
  );
}

function DeleteLinkDialog({ link, onClose, onDeleted }: { link: SharedLink; onClose: () => void; onDeleted: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      await readResponse(await fetch(`/api/links/${encodeURIComponent(link.id)}`, { method: "DELETE" }));
      dialogRef.current?.close();
      onDeleted();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to delete link.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="link-delete-title" aria-describedby="link-delete-description" aria-busy={deleting} onCancel={(event) => { event.preventDefault(); if (!deleting) close(); }} className="m-auto w-[calc(100%-3rem)] max-w-md border border-white/10 bg-slate-900 p-5 text-slate-200 shadow-2xl backdrop:bg-slate-950/70">
      <h2 id="link-delete-title" className="text-lg font-semibold text-white">Delete link?</h2>
      <div id="link-delete-description" className="mt-3">
        <p className="break-words text-sm font-medium text-white [overflow-wrap:anywhere]">{link.title}</p>
        <p className="mt-1 break-words text-xs text-slate-400 [overflow-wrap:anywhere]">{link.url}</p>
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus disabled={deleting} onClick={close} className="h-9 border border-white/10 px-3 text-sm hover:bg-white/10 disabled:opacity-60">Cancel</button>
        <button type="button" disabled={deleting} onClick={() => void confirmDelete()} className="h-9 bg-rose-500 px-3 text-sm font-medium text-white hover:bg-rose-400 disabled:bg-rose-800 disabled:text-rose-200">{deleting ? "Deleting…" : "Delete link"}</button>
      </div>
    </dialog>
  );
}

function LinkForm({ link, onClose, onSaved }: { link: SharedLink | null; onClose: () => void; onSaved: (link: SharedLink) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [description, setDescription] = useState(link?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(link ? `/api/links/${encodeURIComponent(link.id)}` : "/api/links", {
        method: link ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, url, description }),
      });
      const body = await readResponse<{ link: SharedLink }>(response);
      dialogRef.current?.close();
      onSaved(body.link);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save link.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "mt-2 w-full border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/50";
  return (
    <dialog ref={dialogRef} aria-labelledby="link-form-title" onCancel={(event) => { event.preventDefault(); if (!saving) close(); }} className="m-auto w-[calc(100%-3rem)] max-w-md border border-white/10 bg-slate-900 p-5 text-slate-200 shadow-2xl backdrop:bg-slate-950/70">
      <form onSubmit={(event) => void save(event)}>
        <h2 id="link-form-title" className="text-lg font-semibold text-white">{link ? "Edit link" : "Add link"}</h2>
        <fieldset disabled={saving} className="mt-5 space-y-4">
          <label className="block text-sm font-medium">Title<input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></label>
          <label className="block text-sm font-medium">URL<input required type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)} className={inputClass} placeholder="example.com" /></label>
          <label className="block text-sm font-medium">Description <span className="font-normal text-slate-400">(optional)</span><textarea maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className={`${inputClass} resize-y`} /></label>
        </fieldset>
        {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={close} className="h-9 border border-white/10 px-3 text-sm hover:bg-white/10 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving || !title.trim() || !url.trim()} className="h-9 bg-white px-3 text-sm font-medium text-slate-950 hover:bg-slate-200 disabled:bg-slate-700 disabled:text-slate-400">{saving ? "Saving…" : link ? "Save changes" : "Add link"}</button>
        </div>
      </form>
    </dialog>
  );
}
