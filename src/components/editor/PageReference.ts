import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { pageReferenceHref, type PageReferenceSuggestion } from "@/lib/pageReferenceTypes";

const referenceKey = new PluginKey("novoPageReference");

function createPageIcon() {
  // Match the Lucide FileText icon used for attachments, in this DOM-rendered picker.
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false", class: "page-reference-icon",
  })) icon.setAttribute(name, value);
  for (const d of [
    "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
    "M14 2v5a1 1 0 0 0 1 1h5", "M10 9H8", "M16 13H8", "M16 17H8",
  ]) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", d);
    icon.append(path);
  }
  return icon;
}

export function createPageReferenceExtension(currentPageId: () => string) {
  return Mention.extend({
    name: "pageReference",
    parseHTML() {
      return [{ tag: 'a[data-type="pageReference"]' }, { tag: 'span[data-type="pageReference"]' }];
    },
  }).configure({
    HTMLAttributes: { class: "novo-page-reference", contenteditable: "false" },
    renderText: ({ node }) => String(node.attrs.label || "Untitled"),
    renderHTML: ({ node, options }) => [
      "a",
      {
        ...options.HTMLAttributes,
        href: pageReferenceHref(String(node.attrs.id ?? "")),
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Open referenced page in a new tab",
      },
      String(node.attrs.label || "Untitled"),
    ],
    suggestion: {
      pluginKey: referenceKey,
      char: "@",
      allowSpaces: true,
      allowedPrefixes: [" ", "\t", "\n", "(", "["],
      allow: ({ editor, state, range }) => {
        const from = state.doc.resolve(range.from);
        return editor.isEditable
          && range.to - range.from <= 121
          && !from.parent.type.spec.code
          && !from.marks().some((mark) => mark.type.name === "code" || mark.type.name === "link")
          && !!from.parent.type.contentMatch.matchType(state.schema.nodes.pageReference);
      },
      render: () => createReferencePicker(currentPageId),
    },
  });
}

function createReferencePicker(currentPageId: () => string) {
  let props: SuggestionProps | null = null;
  let popup: HTMLDivElement | null = null;
  let options: HTMLDivElement | null = null;
  let pages: PageReferenceSuggestion[] = [];
  let selected = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let requestVersion = 0;
  const id = `page-reference-${globalThis.crypto.randomUUID()}`;

  function cancelRequest() {
    clearTimeout(timer);
    request?.abort();
    requestVersion += 1;
  }

  function position() {
    if (!popup || !props) return;
    const rect = props.clientRect?.();
    if (!rect) return;
    const width = Math.min(390, window.innerWidth - 24);
    popup.style.width = `${width}px`;
    const height = popup.getBoundingClientRect().height;
    const top = rect.bottom + 6 + height <= window.innerHeight - 12
      ? rect.bottom + 6
      : Math.max(12, rect.top - height - 6);
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    popup.style.top = `${top}px`;
  }

  function dismiss() {
    if (props && !props.editor.isDestroyed) exitSuggestion(props.editor.view, referenceKey);
    else close();
  }

  function outside(event: PointerEvent) {
    if (popup && event.target instanceof globalThis.Node && !popup.contains(event.target) && !props?.editor.view.dom.contains(event.target)) dismiss();
  }

  function close() {
    cancelRequest();
    if (props && !props.editor.isDestroyed) {
      for (const attr of ["aria-controls", "aria-expanded", "aria-activedescendant"]) props.editor.view.dom.removeAttribute(attr);
    }
    popup?.remove();
    popup = null;
    options = null;
    props = null;
    pages = [];
    window.removeEventListener("resize", position);
    document.removeEventListener("scroll", position, true);
    document.removeEventListener("pointerdown", outside, true);
  }

  function choose(index: number) {
    const page = pages[index];
    if (!page || !props?.editor.isEditable) return;
    props.command({ id: page.id, label: page.title || "Untitled" });
  }

  function select(index: number) {
    selected = index;
    options?.querySelectorAll<HTMLElement>('[role="option"]').forEach((item, i) => {
      item.setAttribute("aria-selected", String(i === selected));
    });
    const active = options?.children[selected] as HTMLElement | undefined;
    if (active) {
      props?.editor.view.dom.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function render(message?: string) {
    if (!popup || !options || !props) return;
    options.replaceChildren();
    props.editor.view.dom.removeAttribute("aria-activedescendant");
    if (message) {
      const status = document.createElement("div");
      status.className = "page-reference-status";
      status.setAttribute("role", "status");
      status.textContent = message;
      options.append(status);
    } else {
      pages.forEach((page, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.tabIndex = -1;
        item.id = `${id}-${index}`;
        item.className = "page-reference-option";
        item.setAttribute("role", "option");
        const copy = document.createElement("span");
        copy.className = "page-reference-copy";
        const title = document.createElement("span");
        title.className = "page-reference-title";
        title.textContent = page.title || "Untitled";
        const context = document.createElement("span");
        context.className = "page-reference-context";
        context.textContent = page.notebookName;
        copy.append(title, context);
        item.append(createPageIcon(), copy);
        item.addEventListener("pointerdown", (event) => event.preventDefault());
        item.addEventListener("click", () => choose(index));
        item.addEventListener("pointermove", () => select(index));
        options!.append(item);
      });
      select(selected);
    }
    position();
  }

  function update(next: SuggestionProps) {
    const state = referenceKey.getState(next.editor.state);
    if (!state?.active || state.range.from !== next.range.from || state.query !== next.query) return;
    cancelRequest();
    props = next;
    pages = [];
    selected = 0;
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "page-reference-picker";
      options = document.createElement("div");
      options.id = id;
      options.className = "page-reference-options";
      options.setAttribute("role", "listbox");
      options.setAttribute("aria-label", "Reference a page");
      popup.append(options);
      document.body.append(popup);
      window.addEventListener("resize", position);
      document.addEventListener("scroll", position, true);
      document.addEventListener("pointerdown", outside, true);
    }
    next.editor.view.dom.setAttribute("aria-controls", id);
    next.editor.view.dom.setAttribute("aria-expanded", "true");
    render("Searching pages…");
    const version = requestVersion;
    timer = setTimeout(async () => {
      const controller = new AbortController();
      request = controller;
      try {
        const params = new URLSearchParams({ q: next.query, currentPageId: currentPageId() });
        const response = await fetch(`/api/pages/references?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load pages");
        const data = await response.json() as { pages: PageReferenceSuggestion[] };
        if (version !== requestVersion || !props?.editor.isEditable) return;
        pages = data.pages;
        render(pages.length ? undefined : "No matching pages");
      } catch {
        if (version === requestVersion && !controller.signal.aborted) render("Could not load pages. Keep typing to retry.");
      }
    }, 150);
  }

  return {
    onStart: update,
    onUpdate: update,
    onExit: close,
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.isComposing) return false;
      if (event.key === "Escape") { dismiss(); return true; }
      if (!pages.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        select((selected + (event.key === "ArrowDown" ? 1 : pages.length - 1)) % pages.length);
        return true;
      }
      if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
        choose(selected);
        return true;
      }
      return false;
    },
  };
}
