"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Check, ChevronDown } from "lucide-react";
import { useRef } from "react";
import { EDITOR_FONTS, editorFontFamily } from "@/lib/editorFonts";

export function FontFamilyMenu({ editor }: { editor: Editor }) {
  const keepEditorFocus = useRef(false);
  const font = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => ({
      value: editorFontFamily(activeEditor.getAttributes("textStyle").fontFamily) ?? "",
      disabled: activeEditor.isActive("codeBlock"),
    }),
  });
  const selected = EDITOR_FONTS.find((option) => option.value === font.value) ?? EDITOR_FONTS[0];

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title="Font"
          aria-label={`Font: ${selected.label}`}
          disabled={font.disabled}
          onMouseDown={(event) => event.preventDefault()}
          className="inline-flex h-8 w-28 cursor-pointer items-center justify-between gap-2 border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="truncate" style={{ fontFamily: selected.value || undefined }}>{selected.label}</span>
          <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          aria-label="Font"
          onCloseAutoFocus={(event) => {
            if (!keepEditorFocus.current) return;
            event.preventDefault();
            keepEditorFocus.current = false;
          }}
          className="z-[1000] min-w-40 border border-slate-200 bg-white p-1 shadow-md outline-none"
        >
          <DropdownMenu.RadioGroup value={font.value}>
            {EDITOR_FONTS.map((option) => (
              <DropdownMenu.RadioItem
                key={option.label}
                value={option.value}
                onSelect={() => {
                  keepEditorFocus.current = true;
                  const command = editor.chain().focus(undefined, { scrollIntoView: false });
                  if (option.value) command.setFontFamily(option.value).run();
                  else command.unsetFontFamily().run();
                }}
                className="relative cursor-pointer select-none py-1.5 pl-7 pr-3 text-sm text-slate-700 outline-none data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900"
                style={{ fontFamily: option.value || undefined }}
              >
                <DropdownMenu.ItemIndicator className="absolute inset-y-0 left-2 flex items-center">
                  <Check size={12} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
