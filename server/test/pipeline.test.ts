import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtractedInvoice, InvoiceRecord } from "@ledgerrun/contract";
import { catalogFor, snapshot } from "./seed.js";

const extractInvoice = vi.fn();
const resolveEntities = vi.fn();
const proposeMatches = vi.fn();
const proposeDecision = vi.fn();
const llmConfigured = vi.fn(() => true);
const fetchReferenceSnapshot = vi.fn();
const fetchCatalog = vi.fn();

vi.mock("../src/llm.js", () => ({
  extractInvoice,
  resolveEntities,
  proposeMatches,
  proposeDecision,
  llmConfigured,
  LlmBusyError: class LlmBusyError extends Error {},
}));
vi.mock("../src/mcp/client.js", () => ({
  fetchReferenceSnapshot,
  fetchCatalog,
}));

const source = { kind: "pdf" as const, filename: "invoice.pdf", email: null };

const cleanExtracted: ExtractedInvoice = {
  metadata: {
    invoice_number: "PIPE-001",
    invoice_date: "2026-06-01",
    sponsor_name: "Contoso Therapeutics",
    study_name: "CATALYST Trial",
    protocol_number: "CON-CAT-2024-101",
    site_name: "Willow Creek Clinical Research Center",
    pi_name: null,
    total_amount: 975,
  },
  line_items: [
    { description: "Screening", quantity: 1, unit_price: 480, amount: 480 },
    { description: "CBC", quantity: 1, unit_price: 95, amount: 95 },
    { description: "Site Fee", quantity: 1, unit_price: 400, amount: 400 },
  ],
};

const cleanEntityProposal = {
  sponsor: { id: 2, confidence: 0.99, reason: "exact" },
  study: { id: 3, confidence: 0.99, reason: "exact" },
  site: { id: 1, confidence: 0.99, reason: "exact" },
};

const cleanMatchProposal = {
  matches: [
    { line_index: 0, item_code: "VISIT-SCR", confidence: 0.98, reason: "screening" },
    { line_index: 1, item_code: "LAB-CBC", confidence: 0.94, reason: "cbc" },
    { line_index: 2, item_code: "ADMIN-SITE", confidence: 0.96, reason: "site fee" },
  ],
};

async function freshModules() {
  process.env.DB_PATH = join(tmpdir(), `ledgerrun-pipeline-${randomUUID()}.db`);
  vi.resetModules();
  vi.doMock("../src/llm.js", () => ({
    extractInvoice,
    resolveEntities,
    proposeMatches,
    proposeDecision,
    llmConfigured,
    LlmBusyError: class LlmBusyError extends Error {},
  }));
  vi.doMock("../src/mcp/client.js", () => ({
    fetchReferenceSnapshot,
    fetchCatalog,
  }));
  return {
    pipeline: await import("../src/pipeline.js"),
    db: await import("../src/db.js"),
    storage: await import("../src/storage.js"),
    events: await import("../src/events.js"),
  };
}

describe("pipeline integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llmConfigured.mockReturnValue(true);
    extractInvoice.mockResolvedValue(cleanExtracted);
    resolveEntities.mockResolvedValue(cleanEntityProposal);
    proposeMatches.mockResolvedValue(cleanMatchProposal);
    proposeDecision.mockResolvedValue({
      decision: "submit",
      rationale: "AI reviewed the validated signals and found no blockers.",
      confidence: 0.94,
      exception_codes: [],
      warnings: [],
    });
    fetchReferenceSnapshot.mockResolvedValue(snapshot);
    fetchCatalog.mockImplementation((sponsorId: number, studyId: number) => Promise.resolve(catalogFor(sponsorId, studyId)));
  });

  it("persists the full happy path through submitted state", async () => {
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);

    await pipeline.runPipeline(rec.id, Buffer.from("%PDF"));

    const done = db.getInvoice(rec.id)!;
    expect(done.stage).toBe("done");
    expect(done.status).toBe("submitted");
    expect(done.submitted_by).toBe("ai");
    expect(done.extracted?.metadata.invoice_number).toBe("PIPE-001");
    expect(done.resolved?.study.match?.id).toBe(3);
    expect(done.matches?.map((m) => m.status)).toEqual(["matched", "matched", "matched"]);
    expect(done.decision?.rationale).toContain("AI reviewed");
    expect(done.timings).toMatchObject({
      extract: expect.any(Number),
      reference: expect.any(Number),
      resolve: expect.any(Number),
      catalog: expect.any(Number),
      match: expect.any(Number),
      decision: expect.any(Number),
    });
  });

  it("falls back to deterministic metadata resolution when entity resolution fails", async () => {
    resolveEntities.mockRejectedValueOnce(new Error("model unavailable"));
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);

    await pipeline.runPipeline(rec.id, Buffer.from("%PDF"));

    const done = db.getInvoice(rec.id)!;
    expect(done.status).toBe("submitted");
    expect(done.resolved?.sponsor.match?.id).toBe(2);
    expect(done.resolved?.study.match?.id).toBe(3);
  });

  it("falls back to the deterministic decision draft when decision proposal fails", async () => {
    proposeDecision.mockRejectedValueOnce(new Error("decision failed"));
    extractInvoice.mockResolvedValueOnce({
      ...cleanExtracted,
      metadata: { ...cleanExtracted.metadata, total_amount: 530 },
      line_items: [{ description: "Screening", quantity: 1, unit_price: 530, amount: 530 }],
    });
    proposeMatches.mockResolvedValueOnce({
      matches: [{ line_index: 0, item_code: "VISIT-SCR", confidence: 0.98, reason: "screening" }],
    });
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);

    await pipeline.runPipeline(rec.id, Buffer.from("%PDF"));

    const done = db.getInvoice(rec.id)!;
    expect(done.status).toBe("held");
    expect(done.decision?.exceptions.map((e) => e.code)).toContain("price_mismatch");
    expect(done.decision?.rationale).toContain("Held for QC");
  });

  it("skips catalog matching when metadata cannot scope a catalog", async () => {
    resolveEntities.mockResolvedValueOnce({
      sponsor: { id: null, confidence: 0, reason: "unknown" },
      study: { id: null, confidence: 0, reason: "unknown" },
      site: { id: null, confidence: 0, reason: "unknown" },
    });
    proposeDecision.mockResolvedValueOnce({
      decision: "submit",
      rationale: "AI tried to submit.",
      confidence: 0.9,
      exception_codes: [],
      warnings: [],
    });
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);

    await pipeline.runPipeline(rec.id, Buffer.from("%PDF"));

    const done = db.getInvoice(rec.id)!;
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(proposeMatches).not.toHaveBeenCalled();
    expect(done.matches).toEqual([]);
    expect(done.status).toBe("held");
    expect(done.decision?.exceptions.map((e) => e.code)).toContain("metadata_unresolved");
  });

  it("marks the invoice failed when extraction throws", async () => {
    extractInvoice.mockRejectedValueOnce(new Error("bad pdf"));
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);

    await pipeline.runPipeline(rec.id, Buffer.from("not a pdf"));

    const failed = db.getInvoice(rec.id)!;
    expect(failed.stage).toBe("failed");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Error: bad pdf");
  });

  it("publishes every persisted stage transition", async () => {
    const { pipeline, events } = await freshModules();
    const seen: string[] = [];
    const unsubscribe = events.subscribe((rec: InvoiceRecord) => seen.push(`${rec.stage}:${rec.status}`));
    const rec = pipeline.newInvoice(source);

    await pipeline.runPipeline(rec.id, Buffer.from("%PDF"));
    unsubscribe();

    expect(seen).toEqual(
      expect.arrayContaining([
        "received:processing",
        "extracting:processing",
        "resolving:processing",
        "matching:processing",
        "deciding:processing",
        "done:submitted",
      ]),
    );
  });

  it("applies reviewer metadata corrections and re-decides", async () => {
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);
    db.saveInvoice({
      ...rec,
      stage: "done",
      status: "held",
      extracted: cleanExtracted,
      resolved: null,
      matches: [],
      decision: {
        decision: "hold",
        rationale: "Held for QC: metadata_unresolved.",
        exceptions: [{ code: "metadata_unresolved", severity: "block", message: "missing" }],
      },
    });

    const corrected = await pipeline.applyAction(rec.id, {
      type: "correct_metadata",
      sponsor_id: 2,
      study_id: 3,
      site_id: 1,
    });

    expect(corrected.status).toBe("submitted");
    expect(corrected.resolved?.study.match?.id).toBe(3);
    expect(corrected.qc_actions.at(-1)?.type).toBe("correct_metadata");
    expect(db.getInvoice(rec.id)?.status).toBe("submitted");
  });

  it("rejects match corrections before metadata is resolved", async () => {
    const { pipeline, db } = await freshModules();
    const rec = pipeline.newInvoice(source);
    db.saveInvoice({
      ...rec,
      extracted: cleanExtracted,
      matches: [],
      resolved: null,
    });

    await expect(pipeline.applyAction(rec.id, { type: "correct_match", line_index: 0, item_code: "VISIT-SCR" })).rejects.toThrow(
      "resolve metadata first",
    );
  });

  it("records manual submit, note, and escalation actions", async () => {
    const { pipeline } = await freshModules();
    const rec = pipeline.newInvoice(source);

    const noted = await pipeline.applyAction(rec.id, { type: "note", detail: "Called site for backup." });
    const escalated = await pipeline.applyAction(rec.id, { type: "escalate", reason: "Contract term unclear." });
    const submitted = await pipeline.applyAction(rec.id, { type: "submit" });

    expect(noted.qc_actions.at(-1)?.detail).toContain("Called site");
    expect(escalated.escalated).toBe(true);
    expect(submitted.status).toBe("submitted");
    expect(submitted.submitted_by).toBe("human");
  });
});
