import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DecisionProposal,
  EntityResolutionProposal,
  ExtractedInvoice,
  MatchProposal,
  type ExceptionCode,
} from "@ledgerrun/contract";
import { resolveContextFromProposal } from "../src/resolve.js";
import { buildMatches } from "../src/match.js";
import { decide } from "../src/decide.js";
import { catalogFor, snapshot } from "./seed.js";

const GoldenLine = z.object({
  description: z.string(),
  quantity: z.number().optional(),
  unit_price: z.number().nullable(),
  amount: z.number().nullable(),
  item_code: z.string().nullable().optional(),
  confidence: z.number().optional(),
  omit_proposal: z.boolean().optional(),
});

const GoldenCase = z.object({
  name: z.string(),
  metadata: z.object({
    invoice_number: z.string(),
    sponsor_name: z.string().nullable(),
    study_name: z.string().nullable(),
    protocol_number: z.string().nullable(),
    site_name: z.string().nullable(),
    total_amount: z.number().nullable(),
  }),
  entity: z.object({
    sponsor_id: z.number().nullable(),
    study_id: z.number().nullable(),
    site_id: z.number().nullable(),
    confidence: z.number().optional(),
  }),
  lines: z.array(GoldenLine),
  decisionProposal: DecisionProposal.optional(),
  expected: z.object({
    sponsor_id: z.number().nullable(),
    study_id: z.number().nullable(),
    site_id: z.number().nullable(),
    protocol_match: z.boolean().nullable(),
    decision: z.enum(["submit", "hold"]),
    exceptions: z.array(z.string()),
    matches: z.number().optional(),
  }),
});

const cases = GoldenCase.array().parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../fixtures/deterministic-golden.json", import.meta.url)), "utf8"),
  ),
);

function proposalFor(c: z.infer<typeof GoldenCase>) {
  const confidence = c.entity.confidence ?? 0.98;
  return EntityResolutionProposal.parse({
    sponsor: { id: c.entity.sponsor_id, confidence, reason: "golden sponsor proposal" },
    study: { id: c.entity.study_id, confidence, reason: "golden study proposal" },
    site: { id: c.entity.site_id, confidence, reason: "golden site proposal" },
  });
}

function extractedFor(c: z.infer<typeof GoldenCase>) {
  return ExtractedInvoice.parse({
    metadata: {
      ...c.metadata,
      invoice_date: "2026-06-01",
      pi_name: null,
    },
    line_items: c.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity ?? 1,
      unit_price: line.unit_price,
      amount: line.amount,
    })),
  });
}

function matchProposalFor(c: z.infer<typeof GoldenCase>) {
  return MatchProposal.parse({
    matches: c.lines.flatMap((line, line_index) =>
      line.omit_proposal
        ? []
        : [
            {
              line_index,
              item_code: line.item_code ?? null,
              confidence: line.confidence ?? 0.95,
              reason: "golden match proposal",
            },
          ],
    ),
  });
}

describe("deterministic golden eval set", () => {
  expect(cases.length).toBeGreaterThanOrEqual(20);
  expect(cases.length).toBeLessThanOrEqual(30);

  for (const c of cases) {
    it(c.name, () => {
      const extracted = extractedFor(c);
      const resolved = resolveContextFromProposal(extracted, snapshot, proposalFor(c));
      const matches =
        resolved.sponsor.match && resolved.study.match
          ? buildMatches(extracted.line_items, matchProposalFor(c), catalogFor(resolved.sponsor.match.id, resolved.study.match.id))
          : [];
      const decision = decide(extracted, resolved, matches, c.decisionProposal ?? null);

      expect(resolved.sponsor.match?.id ?? null).toBe(c.expected.sponsor_id);
      expect(resolved.study.match?.id ?? null).toBe(c.expected.study_id);
      expect(resolved.site.match?.id ?? null).toBe(c.expected.site_id);
      expect(resolved.study.protocol_match).toBe(c.expected.protocol_match);
      expect(matches).toHaveLength(c.expected.matches ?? c.lines.length);
      expect(decision.decision).toBe(c.expected.decision);

      const actualCodes = decision.exceptions.map((e) => e.code);
      for (const code of c.expected.exceptions as ExceptionCode[]) {
        expect(actualCodes).toContain(code);
      }
    });
  }
});
