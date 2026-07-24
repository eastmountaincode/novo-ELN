import type { PageStatus } from "@/lib/types";

export const PAGE_STATUS_OPTIONS: Array<{ value: PageStatus; label: string }> = [
  { value: "", label: "No status" },
  { value: "Working", label: "Working" },
  { value: "Needs review", label: "Needs review" },
  { value: "Completed", label: "Completed" },
  { value: "Failed", label: "Failed" },
];

export function getPageStatusLabel(status: PageStatus) {
  return PAGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "No status";
}

export function StatusDot({ status }: { status: PageStatus }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: pageStatusColor(status) }} aria-hidden="true" />;
}

export function pageStatusColor(status: PageStatus) {
  if (status === "Failed") return "#dc2626";
  if (status === "Needs review") return "#d97706";
  if (status === "Completed") return "#16a34a";
  if (status === "Working") return "#2563eb";
  return "#94a3b8";
}
