export type SaveStatusChannel = "attachments" | "body" | "metadata" | "tags";

export type SaveStatusEntry = {
  channel: SaveStatusChannel;
  message: string;
  sequence: number;
};

function statusPriority(message: string) {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("failed")) return 4;
  if (normalized === "unsaved") return 3;
  if (normalized === "saving..." || normalized === "uploading") return 2;
  return normalized ? 1 : 0;
}

export function selectVisibleSaveStatus(entries: SaveStatusEntry[]) {
  return [...entries]
    .filter((entry) => entry.message.trim())
    .sort((left, right) => statusPriority(right.message) - statusPriority(left.message) || right.sequence - left.sequence)[0]?.message ?? "";
}
