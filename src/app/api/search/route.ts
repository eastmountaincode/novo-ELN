import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { searchWorkspace } from "@/lib/search";
import { ensureDatabase } from "@/lib/store";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  ensureDatabase();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 30);
  const modeParam = searchParams.get("mode");
  const mode = modeParam === "fast" || modeParam === "approx" ? modeParam : "full";
  const notebookId = searchParams.get("notebookId")?.trim() || undefined;
  const includeTerms = readSearchTerms(searchParams, "include");
  const excludeTerms = readSearchTerms(searchParams, "exclude");
  const tags = uniqueSearchValues([...searchParams.getAll("tag"), ...splitSearchParam(searchParams.get("tags"))]);
  const fields = uniqueSearchValues([...searchParams.getAll("field"), ...splitSearchParam(searchParams.get("fields"))]);
  return NextResponse.json({
    results: searchWorkspace(user.id, query, Number.isFinite(limit) ? limit : 30, mode, { notebookId, includeTerms, excludeTerms, tags, fields }),
  });
}

function splitSearchParam(value: string | null) {
  return value?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
}

function readSearchTerms(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  return values.length ? uniqueSearchValues(values) : splitSearchParam(searchParams.get(key));
}

function uniqueSearchValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
