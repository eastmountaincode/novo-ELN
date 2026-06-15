import fs from "node:fs";
import path from "node:path";

const generatedDir = path.join(process.cwd(), "src", "generated");
const version = process.env.NOVO_APP_VERSION || new Date().toISOString();

fs.mkdirSync(generatedDir, { recursive: true });
fs.writeFileSync(
  path.join(generatedDir, "app-version.ts"),
  `export const appVersion = ${JSON.stringify(version)};\n`,
);
