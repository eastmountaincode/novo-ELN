"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { AccessRole } from "@/lib/types";

const roleLabels: Record<AccessRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const defaultRoles: readonly AccessRole[] = ["owner", "editor", "viewer"];

type NotebookRoleSelectProps = {
  value: AccessRole;
  onValueChange: (role: AccessRole) => void;
  ariaLabel: string;
  disabled?: boolean;
  roles?: readonly AccessRole[];
};

export function NotebookRoleSelect({ value, onValueChange, ariaLabel, disabled = false, roles = defaultRoles }: NotebookRoleSelectProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${ariaLabel}: ${roleLabels[value]}`}
          className="group inline-flex h-9 min-w-0 flex-1 items-center justify-between gap-2 border border-slate-300 bg-white px-2 text-left text-sm text-slate-950 outline-none select-none focus-visible:border-cyan-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
        >
          <span className="truncate">{roleLabels[value]}</span>
          <ChevronDown size={13} aria-hidden="true" className="relative -top-[0.5px] shrink-0 text-slate-500 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[1000] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto border border-slate-300 bg-white py-1 shadow-md outline-none"
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(nextRole) => {
              if (nextRole !== value && (nextRole === "owner" || nextRole === "editor" || nextRole === "viewer")) {
                onValueChange(nextRole);
              }
            }}
          >
            {roles.map((role) => (
              <DropdownMenu.RadioItem
                key={role}
                value={role}
                className="relative flex cursor-pointer items-center py-1.5 pr-3 pl-7 text-sm text-slate-950 outline-none select-none data-[highlighted]:bg-slate-100"
              >
                <DropdownMenu.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <Check size={13} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
                {roleLabels[role]}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
