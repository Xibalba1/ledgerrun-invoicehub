import { randomUUID } from "node:crypto";
import type { InvoiceRecord, LineItemMatch, ResolvedContext, ActionRequest, ExtractedLineItem } from "@ledgerrun/contract";
import { fetchReferenceSnapshot, fetchCatalog } from "./mcp/client.js";
import { resolveContextDeterministic, resolveContextFromProposal } from "./resolve.js";
import { buildMatches, classifyMatch } from "./match.js";
import { decide } from "./decide.js";
import { extractInvoice, proposeMatches, resolveEntities } from "./llm.js";
import { getInvoice, saveInvoice } from "./db.js";
import { loadPdf } from "./storage.js";
import { log, timed } from "./logger.js";

const now = () => new Date().toISOString();
const persist = (rec: InvoiceRecord): InvoiceRecord => (saveInvoice(rec), rec);

export function newInvoice(source: InvoiceRecord["source"]): InvoiceRecord {
  return persist({
    id: randomUUID(),
    created_at: now(),
    source,
    status: "processing",
    stage: "received",
    extracted: null,
    resolved: null,
    matches: null,
    decision: null,
    escalated: false,
    submitted_by: null,
    error: null,
    qc_actions: [],
    timings: {},
  });
}

/**
 * The AI-first pipeline: extract → resolve (LLM over MCP candidates) → match →
 * decide, fully automated. State is persisted after every stage so the hub can
 * watch it progress; the human only enters afterward, via QC actions. Line-item
 * matching is skipped when sponsor+study didn't resolve (no catalog scope) —
 * the decision then holds on `metadata_unresolved`, the QC-required case.
 */
export async function runPipeline(id: string, pdf: Buffer): Promise<void> {
  const at = (fields: Partial<InvoiceRecord>) => persist({ ...getInvoice(id)!, ...fields });
  try {
    at({ stage: "extracting" });
    const [extracted, tExtract] = await timed("extract", { id }, () => extractInvoice(pdf));
    at({ extracted, timings: { ...getInvoice(id)!.timings, extract: tExtract } });

    at({ stage: "resolving" });
    const [snapshot, tRef] = await timed("reference", { id }, () => fetchReferenceSnapshot());
    let resolved: ResolvedContext;
    try {
      const [proposal, tResolve] = await timed("resolve", { id }, () => resolveEntities(extracted, snapshot));
      resolved = resolveContextFromProposal(extracted, snapshot, proposal);
      at({ resolved, timings: { ...getInvoice(id)!.timings, reference: tRef, resolve: tResolve } });
    } catch (err) {
      log.warn("pipeline.resolve_fallback", { id, err: String(err) });
      resolved = resolveContextDeterministic(extracted, snapshot);
      at({ resolved, timings: { ...getInvoice(id)!.timings, reference: tRef } });
    }

    at({ stage: "matching" });
    const matches = await matchAgainstCatalog(extracted.line_items, resolved, id);
    at({ matches });

    at({ stage: "deciding" });
    const decision = decide(extracted, resolved, matches);
    at({
      stage: "done",
      status: decision.decision === "submit" ? "submitted" : "held",
      decision,
      submitted_by: decision.decision === "submit" ? "ai" : null,
    });
    log.info("pipeline.done", { id, decision: decision.decision });
  } catch (err) {
    persist({ ...getInvoice(id)!, stage: "failed", status: "failed", error: String(err) });
    log.error("pipeline.failed", { id, err: String(err) });
  }
}

async function matchAgainstCatalog(
  lineItems: ExtractedLineItem[],
  resolved: ResolvedContext,
  id: string,
): Promise<LineItemMatch[]> {
  if (!resolved.sponsor.match || !resolved.study.match || lineItems.length === 0) return [];
  const [catalog, tCat] = await timed("catalog", { id }, () =>
    fetchCatalog(resolved.sponsor.match!.id, resolved.study.match!.id),
  );
  const [proposal, tMatch] = await timed("match", { id, items: lineItems.length, catalog: catalog.length }, () =>
    proposeMatches(lineItems, catalog),
  );
  persist({ ...getInvoice(id)!, timings: { ...getInvoice(id)!.timings, catalog: tCat, match: tMatch } });
  return buildMatches(lineItems, proposal, catalog);
}

// ── QC actions (post-decision human control) ─────────────────────────────────

const qc = (rec: InvoiceRecord, type: InvoiceRecord["qc_actions"][number]["type"], detail: string): InvoiceRecord => ({
  ...rec,
  qc_actions: [...rec.qc_actions, { id: randomUUID(), at: now(), type, by: "reviewer", detail }],
});

export async function applyAction(id: string, action: ActionRequest): Promise<InvoiceRecord> {
  const rec = getInvoice(id);
  if (!rec) throw new Error("invoice not found");

  switch (action.type) {
    case "correct_metadata":
      return persist(await correctMetadata(rec, action));
    case "correct_match":
      return persist(await correctMatch(rec, action));
    case "rerun":
      await runPipeline(id, loadPdf(id));
      return persist(qc(getInvoice(id)!, "rerun", "Re-ran the full pipeline."));
    case "escalate":
      return persist(qc({ ...rec, escalated: true }, "escalate", action.reason));
    case "submit":
      return persist(
        qc({ ...rec, status: "submitted", submitted_by: "human" }, "submit", "Submitted by reviewer (manual override)."),
      );
    case "note":
      return persist(qc(rec, "note", action.detail));
  }
}

async function correctMetadata(
  rec: InvoiceRecord,
  a: Extract<ActionRequest, { type: "correct_metadata" }>,
): Promise<InvoiceRecord> {
  if (!rec.extracted) throw new Error("nothing extracted yet");
  const snap = await fetchReferenceSnapshot();
  const resolved: ResolvedContext = structuredClone(rec.resolved ?? blankResolution());
  const changes: string[] = [];

  if (a.sponsor_id != null) {
    const s = snap.sponsors.find((x) => x.id === a.sponsor_id);
    if (s) (resolved.sponsor = { match: s, confidence: 1, alternatives: [] }), changes.push(`sponsor=${s.name}`);
  }
  if (a.study_id != null) {
    const s = snap.studies.find((x) => x.id === a.study_id);
    // Human confirmation reconciles the protocol too, clearing protocol_mismatch.
    if (s) (resolved.study = { match: s, confidence: 1, alternatives: [], protocol_match: true }), changes.push(`study=${s.name}`);
  }
  if (a.site_id != null) {
    const s = snap.sites.find((x) => x.id === a.site_id);
    if (s) (resolved.site = { match: s, confidence: 1, alternatives: [] }), changes.push(`site=${s.name}`);
  }

  // Persist the human's correction immediately and publish it — re-matching makes
  // a live LLM call that can fail transiently (e.g. 529), and the reviewer's pick
  // must survive that. On failure the saved `resolved` stands; they retry the match.
  const corrected = persist(qc({ ...rec, resolved }, "correct_metadata", `Corrected ${changes.join(", ") || "metadata"}.`));

  // Re-match against the (possibly new) catalog scope, then re-decide.
  const matches = await matchAgainstCatalog(corrected.extracted!.line_items, resolved, corrected.id);
  const decision = decide(corrected.extracted!, resolved, matches);
  return {
    ...corrected,
    matches,
    decision,
    stage: "done",
    status: decision.decision === "submit" ? "submitted" : "held",
    submitted_by: decision.decision === "submit" ? "ai" : rec.submitted_by,
  };
}

async function correctMatch(
  rec: InvoiceRecord,
  a: Extract<ActionRequest, { type: "correct_match" }>,
): Promise<InvoiceRecord> {
  if (!rec.extracted || !rec.matches) throw new Error("no matches to correct");
  if (!rec.resolved?.sponsor.match || !rec.resolved.study.match) throw new Error("resolve metadata first");
  const catalog = await fetchCatalog(rec.resolved.sponsor.match.id, rec.resolved.study.match.id);
  const chosen = a.item_code ? catalog.find((c) => c.item_code === a.item_code) ?? null : null;

  const matches = rec.matches.map((m, i) =>
    i === a.line_index ? classifyMatch(m.line, chosen, 1, "Confirmed by reviewer.") : m,
  );
  const decision = decide(rec.extracted, rec.resolved, matches);
  return qc(
    {
      ...rec,
      matches,
      decision,
      status: decision.decision === "submit" ? "submitted" : "held",
      submitted_by: decision.decision === "submit" ? rec.submitted_by ?? "ai" : rec.submitted_by,
    },
    "correct_match",
    `Set line ${a.line_index} → ${a.item_code ?? "unmatched"}; re-decided → ${decision.decision}.`,
  );
}

function blankResolution(): ResolvedContext {
  const empty = { match: null, confidence: 0, alternatives: [] };
  return { sponsor: { ...empty }, study: { ...empty, protocol_match: null }, site: { ...empty } };
}
