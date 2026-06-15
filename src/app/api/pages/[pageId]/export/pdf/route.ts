import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { buildPageExportHtml, pageExportFilename } from "@/lib/pageExport";
import { getPage, getPageNotebook } from "@/lib/store";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ pageId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pageId } = await context.params;
  let workDir = "";
  try {
    const page = getPage(user.id, pageId);
    const notebook = getPageNotebook(user.id, pageId);
    const html = await buildPageExportHtml(page, notebook);
    const filename = pageExportFilename(page, "pdf");

    workDir = await mkdtemp(path.join(os.tmpdir(), "novo-page-export-"));
    const profileDir = path.join(workDir, "profile");
    const htmlPath = path.join(workDir, "page.html");
    const pdfPath = path.join(workDir, "page.pdf");
    await mkdir(profileDir, { recursive: true });
    await writeFile(htmlPath, html, "utf8");

    await execFileAsync(
      "libreoffice",
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        htmlPath,
      ],
      { timeout: 120_000 },
    );

    const pdf = await readFile(pdfPath);
    return new NextResponse(new Blob([pdf as unknown as BlobPart], { type: "application/pdf" }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${escapeContentDispositionFilename(filename)}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export PDF";
    const status = message === "Forbidden" ? 403 : message === "Page not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function escapeContentDispositionFilename(filename: string) {
  return filename.replace(/[\\"]/g, "_");
}
