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
        body: "<?xml version=\"1.0\"?><en-note><div>First line</div><div>Second &amp; third</div></en-note>",
        tags: ["plasmid", "sortseq"],
        createdAt: undefined,
        updatedAt: undefined,
        resources: [],
        mediaCount: 0,
      },
    ]);
  });

  it("extracts ENEX resources and computes their Evernote media hash", () => {
    const notes = parseEnex(`<?xml version="1.0" encoding="UTF-8"?>
      <en-export>
        <note>
          <title>Gel image</title>
          <content><![CDATA[<en-note><div>Before</div><en-media type="image/png" hash="5d41402abc4b2a76b9719d911017c592"/><div>After</div></en-note>]]></content>
          <resource>
            <data encoding="base64">aGVsbG8=</data>
            <mime>image/png</mime>
            <resource-attributes>
              <file-name>gel.png</file-name>
            </resource-attributes>
          </resource>
        </note>
      </en-export>`);

    expect(notes[0].mediaCount).toBe(1);
    expect(notes[0].resources).toHaveLength(1);
    expect(notes[0].resources[0]).toMatchObject({
      hash: "5d41402abc4b2a76b9719d911017c592",
      fileName: "gel.png",
      mimeType: "image/png",
    });
    expect(notes[0].resources[0].data.toString("utf8")).toBe("hello");
  });
});
