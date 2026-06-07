import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CatalogItem, ReferenceSnapshot } from "@ledgerrun/contract";

// Load the real seed data the reference API serves, so tests are grounded in it.
const dir = fileURLToPath(new URL("../../reference-api/api/seed/data/", import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(dir + f, "utf8"));

export const snapshot: ReferenceSnapshot = ReferenceSnapshot.parse({
  sponsors: load("sponsors.json"),
  studies: load("studies.json"),
  sites: load("sites.json"),
});

const allCatalog: CatalogItem[] = CatalogItem.array().parse(load("catalog_items.json"));

export function catalogFor(sponsorId: number, studyId: number): CatalogItem[] {
  return allCatalog.filter((c) => c.sponsor_id === sponsorId && c.study_id === studyId);
}
