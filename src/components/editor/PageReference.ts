import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { formatDateTime } from "@/lib/dateTime";
import { pageReferenceHref, type PageReferenceSuggestion } from "@/lib/pageReferenceTypes";

const referenceKey = new PluginKey("novoPageReference");

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
    popup.querySelector(".page-reference-heading")!.textContent = props.query ? "Matching pages · Recently updated first" : "Recently updated pages";
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
        const title = document.createElement("span");
        title.className = "page-reference-title";
        title.textContent = page.title || "Untitled";
        const context = document.createElement("span");
        context.className = "page-reference-context";
        context.textContent = page.notebookName;
        const date = document.createElement("span");
        date.className = "page-reference-date";
        date.textContent = `Updated ${formatDateTime(page.updatedAt)}`;
        item.append(title, context, date);
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
      const heading = document.createElement("div");
      heading.className = "page-reference-heading";
      options = document.createElement("div");
      options.id = id;
      options.className = "page-reference-options";
      options.setAttribute("role", "listbox");
      options.setAttribute("aria-label", "Reference a page");
      const footer = document.createElement("div");
      footer.className = "page-reference-footer";
      footer.textContent = "↑↓ to choose · Enter to insert · Esc to dismiss";
      popup.append(heading, options, footer);
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
