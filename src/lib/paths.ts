import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

export const dataDir = process.env.ELN_DATA_DIR ?? path.join(root, "data");
export const uploadDir = process.env.ELN_UPLOAD_DIR ?? path.join(root, "storage", "uploads");
export const previewDir = process.env.ELN_PREVIEW_DIR ?? path.join(dataDir, "previews");
export const proofDir = process.env.ELN_PROOF_DIR ?? path.join(dataDir, "proofs");
export const databasePath = process.env.ELN_DATABASE_PATH ?? path.join(dataDir, "eln.sqlite3");

export function ensureRuntimeDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });
  fs.mkdirSync(proofDir, { recursive: true });
}
