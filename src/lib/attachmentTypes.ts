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

export function attachmentPreviewText(blockType: BlockType, source: "upload" | "evernote") {
  if (source === "evernote") {
    const labels: Record<BlockType, string> = {
      image: "Image imported inline from Evernote.",
      sheet: "Spreadsheet imported from Evernote.",
      pdf: "PDF imported from Evernote.",
      slides: "Slide deck imported from Evernote.",
      sequence: "Sequence file imported from Evernote.",
      file: "File imported from Evernote.",
    };
    return labels[blockType];
  }

  const labels: Record<BlockType, string> = {
    image: "Image stored inline with this page.",
    sheet: "Spreadsheet uploaded; table preview/parser is the next integration step.",
    pdf: "PDF uploaded; text extraction is the next integration step.",
    slides: "Slide deck uploaded; preview rendering is the next integration step.",
    sequence: "Sequence file uploaded; sequence viewer is the next integration step.",
    file: "File uploaded and attached to this page.",
  };
  return labels[blockType];
}
