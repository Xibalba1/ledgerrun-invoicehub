import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.js";

// The post-ingest PDF for each invoice, kept on disk so QC "rerun" can replay the
// pipeline without re-uploading.
const dir = join(dirname(config.dbPath), "uploads");
mkdirSync(dir, { recursive: true });

const pathFor = (id: string) => join(dir, `${id}.pdf`);

export const savePdf = (id: string, pdf: Buffer) => writeFileSync(pathFor(id), pdf);
export const loadPdf = (id: string) => readFileSync(pathFor(id));

export function clearPdfs(): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
