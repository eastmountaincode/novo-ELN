export const EDITOR_FONTS = [
  { label: "Default", value: "" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
] as const;

export function editorFontFamily(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const family = value.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
  return EDITOR_FONTS.find((font) => font.label.toLowerCase() === family)?.value || undefined;
}
