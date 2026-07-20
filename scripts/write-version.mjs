import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const generatedDir = path.join(process.cwd(), "src", "generated");

function currentBuildStamp() {
  const timeZone = process.env.NOVO_BUILD_TIME_ZONE || "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`.trim();
}

function currentGitCommit() {
  try {
    return execSync("git rev-parse --short=8 HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const version = process.env.NOVO_APP_VERSION || process.env.NOVO_BUILD_DATE || currentBuildStamp();
const buildId = process.env.NOVO_BUILD_ID || currentGitCommit() || "unknown";

fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(
  path.join(generatedDir, "app-version.ts"),
  `export const appVersion: string = ${JSON.stringify(version)};\nexport const appBuildId: string = ${JSON.stringify(buildId)};\n`,
);
