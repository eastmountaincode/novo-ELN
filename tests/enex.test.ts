import { describe, expect, it } from "vitest";
import { enmlToEditorDocument, parseEnex } from "../src/lib/enex";

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

  it("preserves Evernote nested lists emitted as sibling lists after list items", () => {
    const document = enmlToEditorDocument(`<en-note>
      <div>General plan:</div>
      <ol>
        <li><div>Test CH22-GPA33 pool cells for GPA33 expression</div></li>
        <li><div>Inject 4 mice with the maximum amount of cells allowed</div></li>
        <ol>
          <li><div>2 mice with CH22</div></li>
          <li><div>2 mice with CH22-GPA33 pool cells</div></li>
        </ol>
        <li><div>Let tumors form over the course over 9 days</div></li>
      </ol>
    </en-note>`, new Map());

    const list = document.content?.find((node) => node.type === "orderedList");
    expect(list?.content).toHaveLength(3);
    expect(JSON.stringify(list?.content?.[1])).toContain("2 mice with CH22");
    expect(JSON.stringify(list?.content?.[1])).toContain("2 mice with CH22-GPA33 pool cells");
  });


  it("preserves deeply nested Evernote sibling lists instead of flattening them", () => {
    const document = enmlToEditorDocument(`<en-note>
      <div>Steps to the project to make progress</div>
      <ul>
        <li><div>Focus on useful structural space</div></li>
        <ul>
          <li><div>amino acid</div></li>
          <li><div>certain hotspots</div></li>
          <ul>
            <li><div>Narrow down the variation</div></li>
            <ul>
              <li><div>need to test it</div></li>
            </ul>
          </ul>
        </ul>
        <li><div>Build the 600 sequences</div></li>
      </ul>
    </en-note>`, new Map());

    const serialized = JSON.stringify(document);
    expect(serialized).toContain("bulletList");
    expect(serialized).toContain("amino acid");
    expect(serialized).toContain("Narrow down the variation");
    expect(serialized).toContain("need to test it");
    expect(serialized).toContain("Build the 600 sequences");
  });

  it("preserves block boundaries when ENML is imperfect", () => {
    const document = enmlToEditorDocument(`<en-note><div>First line</div><div>Second line</div><ul><li>Third line</li></ul>`, new Map());

    expect(document.content).toHaveLength(3);
    expect(JSON.stringify(document)).toContain("First line");
    expect(JSON.stringify(document)).toContain("Second line");
    expect(JSON.stringify(document)).toContain("Third line");
  });
});
