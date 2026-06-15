import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import sharp from "sharp";
import { previewDir } from "./paths";

const execFileAsync = promisify(execFile);

const PRESENTATION_PREVIEW_ROOT = path.join(previewDir, "presentations");
const SLIDE_PREFIX = "slide";
const RENDER_DPI = 120;
const PRESENTATION_PREVIEW_RENDERER_VERSION = "emfplus-bitmap-v1";

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
    .update(PRESENTATION_PREVIEW_RENDERER_VERSION)
    .update("\0")
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
    await patchPresentationEmbeddedMetafiles(inputPath, options.sourceName);

    await runPreviewCommand("libreoffice", [
      "--headless",
      "--nologo",
      "--nolockcheck",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileUrl(path.join(workDir, "lo-profile"))}`,
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      inputPath,
    ], "LibreOffice could not convert this presentation to PDF.");

    const pdfPath = path.join(workDir, "input.pdf");
    await fs.access(pdfPath);

    const outputPrefix = path.join(workDir, SLIDE_PREFIX);
    await runPreviewCommand("pdftoppm", [
      "-png",
      "-r",
      String(RENDER_DPI),
      pdfPath,
      outputPrefix,
    ], "Could not render presentation slides.");

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

async function patchPresentationEmbeddedMetafiles(inputPath: string, sourceName: string) {
  if (path.extname(sourceName).toLowerCase() !== ".pptx") return;

  const archive = unzipSync(new Uint8Array(await fs.readFile(inputPath)));
  const replacements = new Map<string, string>();

  for (const [entryPath, bytes] of Object.entries(archive)) {
    if (!/^ppt\/media\/.+\.emf$/i.test(entryPath)) continue;

    const pngBytes = await extractEmfPlusBitmapPng(bytes);
    if (!pngBytes) continue;

    const parsedPath = path.posix.parse(entryPath);
    let pngPath = path.posix.join(parsedPath.dir, `${parsedPath.name}.png`);
    if (archive[pngPath]) {
      pngPath = path.posix.join(parsedPath.dir, `${parsedPath.name}-novo-emf.png`);
    }

    archive[pngPath] = pngBytes;
    replacements.set(entryPath, pngPath);
  }

  if (!replacements.size) return;

  for (const [entryPath, bytes] of Object.entries(archive)) {
    if (!entryPath.endsWith(".rels")) continue;

    let xml = strFromU8(bytes);
    let changed = false;
    for (const [emfPath, pngPath] of replacements.entries()) {
      const emfName = path.posix.basename(emfPath);
      const pngName = path.posix.basename(pngPath);
      const nextXml = xml
        .replaceAll(`Target="../media/${emfName}"`, `Target="../media/${pngName}"`)
        .replaceAll(`Target="media/${emfName}"`, `Target="media/${pngName}"`);
      if (nextXml !== xml) changed = true;
      xml = nextXml;
    }
    if (changed) archive[entryPath] = strToU8(xml);
  }

  const contentTypesPath = "[Content_Types].xml";
  const contentTypes = archive[contentTypesPath];
  if (contentTypes) {
    let xml = strFromU8(contentTypes);
    if (!/Extension="png"/i.test(xml)) {
      xml = xml.replace(
        "</Types>",
        '<Default Extension="png" ContentType="image/png"/></Types>',
      );
      archive[contentTypesPath] = strToU8(xml);
    }
  }

  await fs.writeFile(inputPath, Buffer.from(zipSync(archive)));
}

async function extractEmfPlusBitmapPng(bytes: Uint8Array) {
  let position = 0;
  while (position + 8 <= bytes.length) {
    const recordType = readUInt32LE(bytes, position);
    const recordSize = readUInt32LE(bytes, position + 4);
    if (recordSize < 8 || position + recordSize > bytes.length) break;

    if (recordType === 0x46) {
      const dataSize = readUInt32LE(bytes, position + 8);
      const dataStart = position + 12;
      const data = bytes.subarray(dataStart, dataStart + dataSize);
      const bitmap = await extractEmfPlusBitmapData(data);
      if (bitmap) return bitmap;
    }

    position += recordSize;
  }
  return null;
}

async function extractEmfPlusBitmapData(data: Uint8Array) {
  if (data.length < 4 || String.fromCharCode(...data.subarray(0, 4)) !== "EMF+") return null;

  let position = 4;
  while (position + 12 <= data.length) {
    const recordType = readUInt16LE(data, position);
    const flags = readUInt16LE(data, position + 2);
    const recordSize = readUInt32LE(data, position + 4);
    const dataSize = readUInt32LE(data, position + 8);
    if (recordSize < 12 || position + recordSize > data.length) break;

    const objectType = (flags >> 8) & 0xff;
    if (recordType === 0x4008 && objectType === 5) {
      const recordData = data.subarray(position + 12, position + 12 + dataSize);
      const png = await convertEmfPlusImageObjectToPng(recordData);
      if (png) return png;
    }

    position += recordSize;
  }
  return null;
}

async function convertEmfPlusImageObjectToPng(data: Uint8Array) {
  if (data.length < 28) return null;

  const imageType = readUInt32LE(data, 4);
  const width = readUInt32LE(data, 8);
  const height = readUInt32LE(data, 12);
  const stride = readUInt32LE(data, 16);
  const pixelFormat = readUInt32LE(data, 20);
  if (imageType !== 1 || width <= 0 || height <= 0 || stride < width * 4) return null;

  // The PowerPoint EMFs we need to rescue store a 32-bit BGRA GDI+ bitmap.
  if (!new Set([0xe200b, 0x26200a, 0x26200b]).has(pixelFormat)) return null;

  const rawStart = 28;
  const rawLength = stride * height;
  if (data.length < rawStart + rawLength) return null;

  const raw = data.subarray(rawStart, rawStart + rawLength);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * stride + x * 4;
      const target = (y * width + x) * 4;
      rgba[target] = raw[source + 2];
      rgba[target + 1] = raw[source + 1];
      rgba[target + 2] = raw[source];
      rgba[target + 3] = raw[source + 3];
    }
  }

  return new Uint8Array(await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer());
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

function readUInt16LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

async function runPreviewCommand(command: string, args: string[], fallbackMessage: string) {
  try {
    await execFileAsync(command, args, { timeout: 120_000, maxBuffer: 1024 * 1024 * 8 });
  } catch (error) {
    const commandError = error as ExecFileException & { stdout?: string; stderr?: string };
    const details = [commandError.stderr, commandError.stdout]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value!.trim())
      .join("\n");
    throw new Error(details ? `${fallbackMessage} ${details}` : fallbackMessage);
  }
}

function pathToFileUrl(value: string) {
  return `file://${value.split(path.sep).map(encodeURIComponent).join("/")}`;
}
