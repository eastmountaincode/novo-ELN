import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const versionScript = path.join(process.cwd(), "scripts", "write-version.mjs");

function generatedVersion(buildDate: string, appVersion = "") {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "novo-version-"));

  try {
    execFileSync(process.execPath, [versionScript], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        NOVO_APP_VERSION: appVersion,
        NOVO_BUILD_DATE: buildDate,
        NOVO_BUILD_ID: "test-build",
        NOVO_BUILD_TIME_ZONE: "America/New_York",
      },
    });

    return readFileSync(
      path.join(workingDirectory, "src", "generated", "app-version.ts"),
      "utf8",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}

describe("version timestamp generation", () => {
  it("formats summer builds in Eastern daylight time", () => {
    expect(generatedVersion("2026-07-28T19:23:16Z")).toContain(
      'appVersion: string = "2026-07-28 15:23 EDT"',
    );
  });

  it("formats winter builds in Eastern standard time", () => {
    expect(generatedVersion("2026-01-28T19:23:16Z")).toContain(
      'appVersion: string = "2026-01-28 14:23 EST"',
    );
  });

  it("keeps an explicit application version unchanged", () => {
    expect(generatedVersion("2026-07-28T19:23:16Z", "release-candidate")).toContain(
      'appVersion: string = "release-candidate"',
    );
  });
});
