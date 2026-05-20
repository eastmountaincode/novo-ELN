import type { BlockType } from "./types";

const blockTypes = new Set<BlockType>(["image", "sheet", "pdf", "slides", "sequence", "file"]);

export function normalizeAttachmentBlockType(value: unknown): BlockType | null {
  return typeof value === "string" && blockTypes.has(value as BlockType) ? (value as BlockType) : null;
}

export function inferAttachmentBlockType(name: string, mimeType: string): BlockType {
  const lowerName = name.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (lowerMime.startsWith("image/") || /\.(png|jpe?g|gif|tiff?|webp|svg)$/.test(lowerName)) return "image";
  if (lowerMime === "application/pdf" || /\.pdf$/.test(lowerName)) return "pdf";
  if (
    lowerMime.includes("spreadsheet") ||
    lowerMime.includes("excel") ||
    lowerMime === "text/csv" ||
    /\.(xlsx?|xlsb|csv|tsv|ods)$/.test(lowerName)
  ) return "sheet";
  if (
    lowerMime.includes("presentation") ||
    lowerMime.includes("powerpoint") ||
    /\.(pptx?|ppsx?|odp|key)$/.test(lowerName)
  ) return "slides";
  if (/\.(gb|gbk|fasta|fa|fna|fastq|fq|dna|seq|ab1)$/.test(lowerName)) return "sequence";
  return "file";
}

export function resolveAttachmentBlockType(input: { name: string; mimeType: string; requestedBlockType?: unknown }): BlockType {
  const inferred = inferAttachmentBlockType(input.name, input.mimeType);
  if (inferred !== "file") return inferred;
  return normalizeAttachmentBlockType(input.requestedBlockType) ?? "file";
}
