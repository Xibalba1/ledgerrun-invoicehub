import { describe, it, expect } from "vitest";
import {
  DecisionProposal,
  type LineItemMatch,
  type ResolvedContext,
  type ExtractedInvoice,
  type Sponsor,
  type Study,
  type Site,
} from "@ledgerrun/contract";
import { decide, buildDecisionDraft, reconcileDecision } from "../src/decide.js";

const sponsor: Sponsor = { id: 1, name: "Northwind Pharma", code: "NWD" };
const study: Study = { id: 1, sponsor_id: 1, name: "LUMIN-2024", protocol_number: "NWD-LUM-2024-001" };
const site: Site = { id: 2, name: "Harborview Medical Institute" };

const resolved = (over: Partial<ResolvedContext> = {}): ResolvedContext => ({
  sponsor: { match: sponsor, confidence: 1, alternatives: [] },
  study: { match: study, confidence: 1, alternatives: [], protocol_match: true },
  site: { match: site, confidence: 1, alternatives: [] },
  ...over,
});

const matched = (description: string): LineItemMatch => ({
  line: { description, quantity: 1, unit_price: 100, amount: 100 },
  catalog_item: { id: 9, sponsor_id: 1, study_id: 1, item_code: "X", description, unit_price: 100 },
  confidence: 0.95,
  reason: "ok",
  price_delta: 0,
  status: "matched",
});

const extracted: ExtractedInvoice = {
  metadata: { protocol_number: "NWD-LUM-2024-001" } as ExtractedInvoice["metadata"],
  line_items: [],
};

describe("decide", () => {
  it("validates typed LLM decision proposals", () => {
    expect(
      DecisionProposal.parse({
        decision: "hold",
        rationale: "AI recommends QC before submission.",
        confidence: 0.82,
        exception_codes: ["ai_review_recommended"],
        warnings: ["Check visit wording."],
      }),
    ).toMatchObject({ decision: "hold", confidence: 0.82 });

    expect(() =>
      DecisionProposal.parse({
        decision: "approve",
        rationale: "not a valid decision",
        confidence: 2,
        exception_codes: ["nope"],
      }),
    ).toThrow();
  });

  it("submits when metadata resolves and every line matches within tolerance (simple)", () => {
    const d = decide(extracted, resolved(), [matched("a"), matched("b")]);
    expect(d.decision).toBe("submit");
    expect(d.exceptions).toHaveLength(0);
  });

  it("holds on a price mismatch (medium)", () => {
    const m = matched("IRB/Ethics Fees");
    m.status = "price_mismatch";
    m.price_delta = 50;
    const d = decide(extracted, resolved(), [matched("a"), m]);
    expect(d.decision).toBe("hold");
    expect(d.exceptions.map((e) => e.code)).toContain("price_mismatch");
  });

  it("holds on unmatched line items (large)", () => {
    const u = matched("Parking Reimbursement");
    u.status = "unmatched";
    u.catalog_item = null;
    const d = decide(extracted, resolved(), [matched("a"), u]);
    expect(d.decision).toBe("hold");
    expect(d.exceptions.map((e) => e.code)).toContain("unmatched_line_items");
  });

  it("holds on unresolved metadata + protocol mismatch (mismatched)", () => {
    const d = decide(
      { metadata: { protocol_number: "NWD-VER-2024-002" } as ExtractedInvoice["metadata"], line_items: [] },
      resolved({
        site: { match: null, confidence: 0.55, alternatives: [{ id: 6, name: "Prairie Field Research Group", score: 0.55 }] },
        study: { match: { ...study, id: 2, name: "VERITAS", protocol_number: "NWD-VER-2023-002" }, confidence: 0.9, alternatives: [], protocol_match: false },
      }),
      [matched("a")],
    );
    expect(d.decision).toBe("hold");
    const codes = d.exceptions.map((e) => e.code);
    expect(codes).toContain("metadata_unresolved");
    expect(codes).toContain("protocol_mismatch");
  });

  it("holds on ambiguous low-confidence matches", () => {
    const a = matched("Visit");
    a.status = "low_confidence";
    a.confidence = 0.4;
    const d = decide(extracted, resolved(), [a]);
    expect(d.decision).toBe("hold");
    expect(d.exceptions.map((e) => e.code)).toContain("low_confidence_match");
  });

  it("treats a total mismatch as a warning, not a block", () => {
    const ex: ExtractedInvoice = {
      metadata: { protocol_number: "NWD-LUM-2024-001", total_amount: 999 } as ExtractedInvoice["metadata"],
      line_items: [],
    };
    const d = decide(ex, resolved(), [matched("a")]); // amounts sum to 100, total says 999
    expect(d.decision).toBe("submit");
    expect(d.exceptions.map((e) => e.code)).toContain("total_mismatch");
    expect(d.exceptions.find((e) => e.code === "total_mismatch")?.severity).toBe("warn");
  });

  it("uses an LLM submit proposal when no deterministic blockers exist", () => {
    const d = decide(extracted, resolved(), [matched("a")], {
      decision: "submit",
      rationale: "AI reviewed the resolved context and matched catalog item; submit.",
      confidence: 0.94,
      exception_codes: [],
      warnings: [],
    });
    expect(d.decision).toBe("submit");
    expect(d.rationale).toContain("AI reviewed");
    expect(d.exceptions).toHaveLength(0);
  });

  it("keeps deterministic blockers authoritative when the LLM proposes submit", () => {
    const m = matched("IRB/Ethics Fees");
    m.status = "price_mismatch";
    m.price_delta = 50;
    const d = decide(extracted, resolved(), [m], {
      decision: "submit",
      rationale: "The invoice appears payable.",
      confidence: 0.75,
      exception_codes: [],
      warnings: [],
    });
    expect(d.decision).toBe("hold");
    expect(d.exceptions.map((e) => e.code)).toContain("price_mismatch");
    expect(d.rationale).toContain("despite the AI submit recommendation");
  });

  it("lets the LLM hold when deterministic policy has no blockers", () => {
    const d = decide(extracted, resolved(), [matched("ambiguous admin fee")], {
      decision: "hold",
      rationale: "AI recommends review because the service period is unclear.",
      confidence: 0.7,
      exception_codes: ["ai_review_recommended"],
      warnings: [],
    });
    expect(d.decision).toBe("hold");
    expect(d.exceptions.map((e) => e.code)).toContain("ai_review_recommended");
    expect(d.exceptions.find((e) => e.code === "ai_review_recommended")?.severity).toBe("block");
  });

  it("retains deterministic warnings when the LLM submits", () => {
    const ex: ExtractedInvoice = {
      metadata: { protocol_number: "NWD-LUM-2024-001", total_amount: 999 } as ExtractedInvoice["metadata"],
      line_items: [],
    };
    const d = decide(ex, resolved(), [matched("a")], {
      decision: "submit",
      rationale: "AI considers the warning non-blocking and recommends submit.",
      confidence: 0.9,
      exception_codes: ["total_mismatch"],
      warnings: ["Total mismatch is non-blocking."],
    });
    expect(d.decision).toBe("submit");
    expect(d.exceptions.map((e) => e.code)).toContain("total_mismatch");
    expect(d.exceptions.find((e) => e.code === "total_mismatch")?.severity).toBe("warn");
  });

  it("falls back to the deterministic draft without a proposal", () => {
    const draft = buildDecisionDraft(extracted, resolved(), [matched("a")]);
    expect(reconcileDecision(draft, null)).toEqual(draft);
  });
});
