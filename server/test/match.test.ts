import { describe, it, expect } from "vitest";
import type { ExtractedLineItem, MatchProposal } from "@ledgerrun/contract";
import { buildMatches } from "../src/match.js";
import { catalogFor } from "./seed.js";

const li = (description: string, quantity: number, unit_price: number): ExtractedLineItem => ({
  description,
  quantity,
  unit_price,
  amount: unit_price * quantity,
});

const catalyst = catalogFor(2, 3); // Contoso / CATALYST
const lumin = catalogFor(1, 1); // Northwind / LUMIN

describe("buildMatches", () => {
  it("marks clean matches with equal prices as matched (simple invoice)", () => {
    const lines = [
      li("Site Management Fee", 1, 400),
      li("Screening Visit", 2, 480),
      li("Complete Blood Count", 1, 95),
    ];
    const proposal: MatchProposal = {
      matches: [
        { line_index: 0, item_code: "ADMIN-SITE", confidence: 0.95, reason: "Site Fee" },
        { line_index: 1, item_code: "VISIT-SCR", confidence: 0.97, reason: "Screening" },
        { line_index: 2, item_code: "LAB-CBC", confidence: 0.9, reason: "CBC" },
      ],
    };
    const matches = buildMatches(lines, proposal, catalyst);
    expect(matches.map((m) => m.status)).toEqual(["matched", "matched", "matched"]);
    expect(matches.every((m) => m.price_delta === 0)).toBe(true);
  });

  it("flags a price mismatch when billed price exceeds catalog (medium IRB)", () => {
    const lines = [li("IRB/Ethics Fees", 1, 550)];
    const proposal: MatchProposal = {
      matches: [{ line_index: 0, item_code: "ADMIN-IRB", confidence: 0.9, reason: "IRB" }],
    };
    const [m] = buildMatches(lines, proposal, lumin);
    expect(m!.status).toBe("price_mismatch");
    expect(m!.price_delta).toBe(50); // 550 − 500
  });

  it("marks unmatched when the model returns no code or an unknown code", () => {
    const lines = [li("Parking Reimbursement", 15, 25), li("Patient Stipend", 12, 75)];
    const proposal: MatchProposal = {
      matches: [
        { line_index: 0, item_code: null, confidence: 0, reason: "not in catalog" },
        { line_index: 1, item_code: "NOPE-XYZ", confidence: 0.4, reason: "hallucinated code" },
      ],
    };
    const matches = buildMatches(lines, proposal, lumin);
    expect(matches.map((m) => m.status)).toEqual(["unmatched", "unmatched"]);
  });

  it("flags low-confidence (ambiguous) matches", () => {
    const lines = [li("Visit", 1, 450)];
    const proposal: MatchProposal = {
      matches: [{ line_index: 0, item_code: "VISIT-SCR", confidence: 0.42, reason: "ambiguous which visit" }],
    };
    const [m] = buildMatches(lines, proposal, lumin);
    expect(m!.status).toBe("low_confidence");
  });
});
