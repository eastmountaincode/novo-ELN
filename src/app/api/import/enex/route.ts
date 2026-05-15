import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { parseEnex } from "@/lib/enex";
import { importNotebook } from "@/lib/store";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "");
  const notebookName = String(form.get("notebookName") ?? "Evernote Import");
  const file = form.get("file");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "ENEX file is required" }, { status: 400 });

  const xml = await file.text();
  const notes = parseEnex(xml);
  const notebookId = importNotebook({ userId: user.id, projectId, notebookName, pages: notes });
  return NextResponse.json({ notebookId, importedPages: notes.length });
}
