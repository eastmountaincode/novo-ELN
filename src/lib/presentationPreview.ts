import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { previewDir } from "./paths";

const execFileAsync = promisify(execFile);

const PRESENTATION_PREVIEW_ROOT = path.join(previewDir, "presentations");
const SLIDE_PREFIX = "slide";
const RENDER_DPI = 120;

export type PresentationPreviewSlide = {
  index: number;
  imageUrl: string;
};

export type PresentationPreview = {
  slideCount: number;
  slides: PresentationPreviewSlide[];
};

export async function createPresentationPreview(options: {
  attachmentId: string;
  sourcePath: string;
  sourceName: string;
  signature: string;
  baseUrl: string;
}): Promise<PresentationPreview> {
  const cacheDir = presentationCacheDir(options.attachmentId, options.signature);
  await fs.mkdir(cacheDir, { recursive: true });

  let slideFiles = await listSlideFiles(cacheDir);
  if (!slideFiles.length) {
    slideFiles = await renderPresentationSlides({
      sourcePath: options.sourcePath,
      sourceName: options.sourceName,
      cacheDir,
    });
  }

  return {
    slideCount: slideFiles.length,
    slides: slideFiles.map((fileName, index) => ({
      index: index + 1,
      imageUrl: `${options.baseUrl}/${encodeURIComponent(fileName)}?v=${encodeURIComponent(options.signature)}`,
    })),
  };
}

export function presentationPreviewSignature(input: { storageKey: string; size: number; updatedAt?: string }) {
  return createHash("sha1")
    .update(input.storageKey)
    .update("\0")
    .update(String(input.size))
    .update("\0")
    .update(input.updatedAt ?? "")
    .digest("hex")
    .slice(0, 16);
}

export function presentationCacheDir(attachmentId: string, signature: string) {
  return path.join(PRESENTATION_PREVIEW_ROOT, safePathSegment(attachmentId), safePathSegment(signature));
}

export function safeSlideFileName(fileName: string) {
  const decoded = decodeURIComponent(fileName);
  if (!new RegExp(`^${SLIDE_PREFIX}-\\d+\\.png$`).test(decoded)) return null;
  return decoded;
}

async function renderPresentationSlides(options: { sourcePath: string; sourceName: string; cacheDir: string }) {
  const workDir = path.join(options.cacheDir, `work-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const inputPath = path.join(workDir, `input${extensionForLibreOffice(options.sourceName)}`);
    await fs.copyFile(options.sourcePath, inputPath);

    await execFileAsync("libreoffice", [
      "--headless",
      "--nologo",
      "--nolockcheck",
      "--nodefault",
      "--nofirststartwizard",
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      inputPath,
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 });

    const pdfPath = path.join(workDir, "input.pdf");
    await fs.access(pdfPath);

    const outputPrefix = path.join(workDir, SLIDE_PREFIX);
    await execFileAsync("pdftoppm", [
      "-png",
      "-r",
      String(RENDER_DPI),
      pdfPath,
      outputPrefix,
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 });

    const renderedFiles = await listRenderedFiles(workDir);
    if (!renderedFiles.length) throw new Error("No slides were rendered from this presentation.");

    const slideFiles: string[] = [];
    for (const [index, renderedFile] of renderedFiles.entries()) {
      const fileName = `${SLIDE_PREFIX}-${index + 1}.png`;
      await fs.rename(path.join(workDir, renderedFile), path.join(options.cacheDir, fileName));
      slideFiles.push(fileName);
    }
    return slideFiles;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function listSlideFiles(cacheDir: string) {
  try {
    const entries = await fs.readdir(cacheDir);
    return entries
      .filter((entry) => safeSlideFileName(entry))
      .sort((left, right) => slideNumber(left) - slideNumber(right));
  } catch {
    return [];
  }
}

async function listRenderedFiles(workDir: string) {
  const entries = await fs.readdir(workDir);
  return entries
    .filter((entry) => new RegExp(`^${SLIDE_PREFIX}-\\d+\\.png$`).test(entry))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
}

function slideNumber(fileName: string) {
  const match = fileName.match(/-(\d+)\.png$/);
  return match ? Number(match[1]) : 0;
}

function extensionForLibreOffice(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if ([".ppt", ".pptx", ".pps", ".ppsx", ".odp"].includes(extension)) return extension;
  return ".pptx";
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
