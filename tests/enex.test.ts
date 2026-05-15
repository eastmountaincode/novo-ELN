import { describe, expect, it } from "vitest";
import { parseEnex } from "../src/lib/enex";

describe("parseEnex", () => {
  it("extracts Evernote note titles, body text, and tags", () => {
    const notes = parseEnex(`<?xml version="1.0" encoding="UTF-8"?>
      <en-export>
        <note>
          <title>Assembly plan</title>
          <content><![CDATA[<?xml version="1.0"?><en-note><div>First line</div><div>Second &amp; third</div></en-note>]]></content>
          <tag>plasmid</tag>
          <tag>sortseq</tag>
        </note>
      </en-export>`);

    expect(notes).toEqual([
      {
        title: "Assembly plan",
        body: "First line\nSecond & third",
        tags: ["plasmid", "sortseq"],
      },
    ]);
  });
});
