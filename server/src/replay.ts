import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  EntityResolutionProposal,
  ExtractedInvoice,
  MatchProposal,
  type InvoiceRecord,
  type LineItemMatch,
  type ResolvedContext,
  type ExtractedLineItem,
} from "@ledgerrun/contract";
import { ingest } from "./ingest.js";
import { newInvoice } from "./pipeline.js";
import { savePdf } from "./storage.js";
import { getInvoice, saveInvoice } from "./db.js";
import { fetchReferenceSnapshot, fetchCatalog } from "./mcp/client.js";
import { resolveContextFromProposal } from "./resolve.js";
import { buildMatches } from "./match.js";
import { decide } from "./decide.js";
import { log } from "./logger.js";

// Demo path: drive the four sample invoices through the SAME resolve→match→decide
// chain as production, but swap the LLM calls for recorded outputs and pace
// each stage so the hub's pipeline theater is legible. Lets the demo play
// identically with or without an ANTHROPIC_API_KEY, and without spending tokens.
const root = fileURLToPath(new URL("../..", import.meta.url));
const recorded: Record<string, { extracted: unknown; entityResolutionProposal: unknown; matchProposal: unknown }> = JSON.parse(
  readFileSync(join(root, "fixtures/recorded.json"), "utf8"),
);

// Narrative order: clean submits first, ending on the held one ("this needs you").
const SAMPLES = ["simple-invoice", "medium-invoice", "large-invoice", "mismatched-metadata-invoice"];

const BEAT = 850; // per-stage dwell — long enough to read, short enough to delight
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function seedDemo(): Promise<string[]> {
  const names = SAMPLES.filter((n) => recorded[n]);
  const ids: string[] = [];
  for (const [i, name] of names.entries()) {
    const sample = loadSample(name);
    const { pdf, source } = await ingest(sample.bytes, sample.filename);
    const rec = newInvoice(source);
    savePdf(rec.id, pdf);
    ids.push(rec.id);
    // Stagger the runs so the cards cascade through the lanes instead of all at once.
    void delay(i * 550).then(() => runReplayPipeline(rec.id, name));
  }
  log.info("demo.seeded", { count: ids.length });
  return ids;
}

function loadSample(name: string): { bytes: Buffer; filename: string } {
  const emlPath = join(root, "fixtures/emls", `${name}.eml`);
  if (existsSync(emlPath)) return { bytes: readFileSync(emlPath), filename: `${name}.eml` };

  const pdfPath = join(root, "sample-invoices", `${name}.pdf`);
  return { bytes: readFileSync(pdfPath), filename: `${name}.pdf` };
}

export async function runReplayPipeline(id: string, name: string): Promise<void> {
  const at = (fields: Partial<InvoiceRecord>) => {
    const rec = getInvoice(id);
    if (rec) saveInvoice({ ...rec, ...fields });
  };
  const timings = () => getInvoice(id)?.timings ?? {};
  try {
    const sample = recorded[name];
    if (!sample) throw new Error(`no recorded fixture for "${name}"`);
    const extracted = ExtractedInvoice.parse(sample.extracted);
    const entityProposal = EntityResolutionProposal.parse(sample.entityResolutionProposal);
    const proposal = MatchProposal.parse(sample.matchProposal);

    at({ stage: "extracting" });
    await delay(BEAT);
    at({ extracted, timings: { ...timings(), extract: BEAT } });

    at({ stage: "resolving" });
    await delay(BEAT);
    const snapshot = await fetchReferenceSnapshot();
    const resolved = resolveContextFromProposal(extracted, snapshot, entityProposal);
    at({ resolved, timings: { ...timings(), reference: BEAT } });

    at({ stage: "matching" });
    await delay(BEAT);
    const matches = await replayMatch(extracted.line_items, resolved, proposal);
    at({ matches, timings: { ...timings(), match: BEAT } });

    at({ stage: "deciding" });
    await delay(BEAT);
    const decision = decide(extracted, resolved, matches);
    at({
      stage: "done",
      status: decision.decision === "submit" ? "submitted" : "held",
      decision,
      submitted_by: decision.decision === "submit" ? "ai" : null,
    });
    log.info("replay.done", { id, name, decision: decision.decision });
  } catch (err) {
    at({ stage: "failed", status: "failed", error: String(err) });
    log.error("replay.failed", { id, name, err: String(err) });
  }
}

async function replayMatch(
  lineItems: ExtractedLineItem[],
  resolved: ResolvedContext,
  proposal: MatchProposal,
): Promise<LineItemMatch[]> {
  if (!resolved.sponsor.match || !resolved.study.match || lineItems.length === 0) return [];
  const catalog = await fetchCatalog(resolved.sponsor.match.id, resolved.study.match.id);
  return buildMatches(lineItems, proposal, catalog);
}
