import { XMLParser } from "fast-xml-parser";

export type ParsedEnexNote = {
  title: string;
  body: string;
  tags: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: false,
  cdataPropName: "__cdata",
});

export function parseEnex(xml: string): ParsedEnexNote[] {
  const parsed = parser.parse(xml) as { "en-export"?: { note?: unknown } };
  const notes = toArray(parsed["en-export"]?.note);
  return notes.map((rawNote) => {
    const note = rawNote as Record<string, unknown>;
    return {
      title: textValue(note.title) || "Untitled Evernote note",
      body: enmlToText(textValue(note.content)),
      tags: toArray(note.tag).map(textValue).filter(Boolean),
    };
  });
}

function enmlToText(enml: string) {
  return enml
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "__cdata" in value) return textValue((value as { __cdata: unknown }).__cdata);
  return "";
}
