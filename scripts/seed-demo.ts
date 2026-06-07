import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  EntityResolutionProposal,
  ExtractedInvoice,
  MatchProposal,
  ReferenceSnapshot,
  CatalogItem,
  type InvoiceRecord,
} from "@ledgerrun/contract";
import { resolveContextFromProposal } from "../server/src/resolve.js";
import { buildMatches } from "../server/src/match.js";
import { decide } from "../server/src/decide.js";
import { saveInvoice } from "../server/src/db.js";
import { savePdf } from "../server/src/storage.js";

// Populate the hub WITHOUT an API key, using the recorded LLM outputs run through
// the real resolve→match→decide chain. Lets you (and the preview) see submitted /
// held / unresolved invoices end-to-end before wiring a live ANTHROPIC_API_KEY.
// Run: npm run seed:demo
const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = join(root, "reference-api/api/seed/data");
const load = (f: string) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));

const snapshot = ReferenceSnapshot.parse({
  sponsors: load("sponsors.json"),
  studies: load("studies.json"),
  sites: load("sites.json"),
});
const allCatalog = CatalogItem.array().parse(load("catalog_items.json"));
const catalogFor = (sp: number, st: number) => allCatalog.filter((c) => c.sponsor_id === sp && c.study_id === st);

const recorded = JSON.parse(readFileSync(join(root, "fixtures/recorded.json"), "utf8"));
const samples = Object.keys(recorded).filter((k) => !k.startsWith("_"));
const now = new Date().toISOString();

for (const [i, name] of samples.entries()) {
  const extracted = ExtractedInvoice.parse(recorded[name].extracted);
  const entityProposal = EntityResolutionProposal.parse(recorded[name].entityResolutionProposal);
  const proposal = MatchProposal.parse(recorded[name].matchProposal);
  const resolved = resolveContextFromProposal(extracted, snapshot, entityProposal);
  const matches =
    resolved.sponsor.match && resolved.study.match
      ? buildMatches(extracted.line_items, proposal, catalogFor(resolved.sponsor.match.id, resolved.study.match.id))
      : [];
  const decision = decide(extracted, resolved, matches);

  const id = randomUUID();
  const rec: InvoiceRecord = {
    id,
    created_at: new Date(Date.parse(now) - (samples.length - i) * 1000).toISOString(),
    source: { kind: "pdf", filename: `${name}.pdf`, email: null },
    status: decision.decision === "submit" ? "submitted" : "held",
    stage: "done",
    extracted,
    resolved,
    matches,
    decision,
    escalated: false,
    submitted_by: decision.decision === "submit" ? "ai" : null,
    error: null,
    qc_actions: [],
    timings: { extract: 0, reference: 0, match: 0 },
  };
  try {
    savePdf(id, readFileSync(join(root, "sample-invoices", `${name}.pdf`)));
  } catch {
    /* pdf optional for the demo seed */
  }
  saveInvoice(rec);
  console.log(`seeded ${name} → ${rec.status}`);
}
