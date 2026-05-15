import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("ENEX import formatting", () => {
  beforeEach(() => {
    vi.resetModules();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eln-enex-formatting-"));
    process.env.ELN_DATA_DIR = path.join(tempDir, "data");
    process.env.ELN_UPLOAD_DIR = path.join(tempDir, "uploads");
    process.env.ELN_DATABASE_PATH = path.join(tempDir, "data", "test.sqlite3");
    process.env.ELN_BOOTSTRAP_EMAIL = "test@example.local";
    process.env.ELN_BOOTSTRAP_PASSWORD = "secret-password";
  });

  it("preserves common Evernote text formatting as editor JSON", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eln-enex-file-"));
    const enexPath = path.join(tempDir, "formatting.enex");
    fs.writeFileSync(enexPath, `<?xml version="1.0" encoding="UTF-8"?>
      <en-export>
        <note>
          <title>Formatted note</title>
          <content><![CDATA[<?xml version="1.0"?><en-note>
            <h2>Section <b>heading</b></h2>
            <div>Plain <b>bold</b> <i>italic</i> <u>under</u> <s>strike</s> <code>code</code> <a href="https://example.org">link</a></div>
            <ul><li>first</li><li><span style="font-weight: bold; text-decoration: underline;">second</span></li></ul>
            <blockquote><div>quoted</div></blockquote>
            <table><tr><th>Head</th><td>Cell<br/>next</td></tr></table>
          </en-note>]]></content>
          <tag>formatted</tag>
        </note>
      </en-export>`);

    const { verifyCredentials, getWorkspace } = await import("../src/lib/store");
    const { importEnexFile } = await import("../src/lib/enex");
    const user = verifyCredentials("test@example.local", "secret-password")!;
    const project = getWorkspace(user.id).projects[0];

    await importEnexFile({ userId: user.id, projectId: project.id, notebookName: "Formatting", filePath: enexPath });

    const importedPage = getWorkspace(user.id).projects[0].notebooks.find((notebook) => notebook.name === "Formatting")?.pages[0];
    const body = JSON.parse(importedPage!.body);

    expect(body.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "heading", attrs: { level: 2 } }),
      expect.objectContaining({ type: "bulletList" }),
      expect.objectContaining({ type: "blockquote" }),
      expect.objectContaining({ type: "table" }),
    ]));
    expect(JSON.stringify(body)).toContain('"type":"bold"');
    expect(JSON.stringify(body)).toContain('"type":"italic"');
    expect(JSON.stringify(body)).toContain('"type":"underline"');
    expect(JSON.stringify(body)).toContain('"type":"strike"');
    expect(JSON.stringify(body)).toContain('"type":"code"');
    expect(JSON.stringify(body)).toContain('"type":"link"');
    expect(importedPage?.tags).toEqual(["formatted"]);
  });
});
