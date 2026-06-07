import { describe, expect, it } from "vitest";
import type { DecisionResult, ExtractedInvoice, LineItemMatch, ResolvedContext } from "@ledgerrun/contract";
import { decisionPromptPayload } from "../src/llm.js";

describe("decisionPromptPayload", () => {
  it("includes the validated signals the decision model needs", () => {
    const extracted: ExtractedInvoice = {
      metadata: {
        invoice_number: "INV-1",
        invoice_date: "2024-01-01",
        sponsor_name: "Northwind Pharma",
        study_name: "LUMIN-2024",
        protocol_number: "NWD-LUM-2024-001",
        site_name: "Harborview",
        pi_name: "Dr. Blake",
        total_amount: 150,
      },
      line_items: [{ description: "IRB fee", quantity: 1, unit_price: 150, amount: 150 }],
    };
    const resolved: ResolvedContext = {
      sponsor: { match: { id: 1, name: "Northwind Pharma", code: "NWD" }, confidence: 0.98, alternatives: [] },
      study: {
        match: {
          id: 1,
          sponsor_id: 1,
          name: "LUMIN-2024",
          protocol_number: "NWD-LUM-2024-001",
          phase: null,
          therapeutic_area: null,
        },
        confidence: 0.97,
        alternatives: [],
        protocol_match: true,
      },
      site: { match: { id: 2, name: "Harborview" }, confidence: 0.96, alternatives: [] },
    };
    const matches: LineItemMatch[] = [
      {
        line: extracted.line_items[0]!,
        catalog_item: {
          id: 9,
          sponsor_id: 1,
          study_id: 1,
          item_code: "ADMIN-IRB",
          description: "IRB maintenance",
          category: "Admin",
          unit_price: 100,
        },
        confidence: 0.91,
        reason: "IRB fee maps to IRB maintenance.",
        price_delta: 50,
        status: "price_mismatch",
      },
    ];
    const draft: DecisionResult = {
      decision: "hold",
      rationale: "Held for QC: price_mismatch.",
      exceptions: [{ code: "price_mismatch", severity: "block", message: "IRB fee billed $150 vs catalog $100." }],
    };

    expect(decisionPromptPayload(extracted, resolved, matches, draft)).toMatchObject({
      extracted_metadata: { invoice_number: "INV-1", total_amount: 150 },
      resolved_context: {
        sponsor: { id: 1, confidence: 0.98 },
        study: { id: 1, protocol_match: true },
        site: { id: 2, confidence: 0.96 },
      },
      matches: [
        {
          line_index: 0,
          status: "price_mismatch",
          catalog_item_code: "ADMIN-IRB",
          price_delta: 50,
          match_reason: "IRB fee maps to IRB maintenance.",
        },
      ],
      deterministic_policy: draft,
    });
  });
});
