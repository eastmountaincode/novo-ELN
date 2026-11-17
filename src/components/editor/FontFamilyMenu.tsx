"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Check, ChevronDown } from "lucide-react";
import { useRef } from "react";
import { EDITOR_FONTS, editorFontFamily } from "@/lib/editorFonts";
import { toolbarMenuContentClassName, toolbarMenuItemClassName, toolbarMenuLabelClassName, toolbarMenuTriggerClassName, toolbarTextMenuTriggerClassName } from "./toolbarMenuStyles";

export function FontFamilyMenu({ editor, commitCommand }: { editor: Editor; commitCommand: (command: () => boolean) => void }) {
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
          className={`${toolbarTextMenuTriggerClassName} ${toolbarMenuTriggerClassName}`}
        >
          <span className={toolbarMenuLabelClassName}>Font</span>
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
          className={`${toolbarMenuContentClassName} min-w-40`}
        >
          <DropdownMenu.RadioGroup value={font.value}>
            {EDITOR_FONTS.map((option) => (
              <DropdownMenu.RadioItem
                key={option.label}
                value={option.value}
                onSelect={() => {
                  keepEditorFocus.current = true;
                  const applyFont = () => {
                    const command = editor.chain().focus(undefined, { scrollIntoView: false });
                    return option.value ? command.setFontFamily(option.value).run() : command.unsetFontFamily().run();
                  };
                  // A caret-only choice sets the font for future typing; selected text must save even while the menu has focus.
                  if (editor.state.selection.empty) applyFont();
                  else commitCommand(applyFont);
                }}
                className={`relative pl-7 pr-3 ${toolbarMenuItemClassName}`}
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
