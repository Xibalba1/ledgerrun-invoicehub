import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DecisionProposal, EntityResolutionProposal, ExtractedInvoice, MatchProposal } from "@ledgerrun/contract";
import { resolveContextFromProposal } from "../src/resolve.js";
import { buildMatches } from "../src/match.js";
import { decide } from "../src/decide.js";
import { snapshot, catalogFor } from "./seed.js";

// Offline eval-smoke: replay recorded LLM outputs through the REAL deterministic
// validation chain (entity proposal → scoped catalog → decision proposal) and
// assert the golden decision per sample. No network — safe for the Stop gate.
// The live LLM eval (eval/run.ts) is the on-demand counterpart that proves
// extraction, entity resolution, matching, and decisioning for real.
const fx = (f: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${f}`, import.meta.url)), "utf8"));
const golden = fx("golden.json");
const recorded = fx("recorded.json");

const samples = Object.keys(golden).filter((k) => !k.startsWith("_"));

describe("eval-smoke (recorded outputs → deterministic decision)", () => {
  for (const name of samples) {
    it(name, () => {
      const g = golden[name];
      const extracted = ExtractedInvoice.parse(recorded[name].extracted);
      const entityProposal = EntityResolutionProposal.parse(recorded[name].entityResolutionProposal);
      const proposal = MatchProposal.parse(recorded[name].matchProposal);
      const decisionProposal = DecisionProposal.parse(recorded[name].decisionProposal);

      const resolved = resolveContextFromProposal(extracted, snapshot, entityProposal);
      expect(resolved.sponsor.match?.id ?? null).toBe(g.sponsor_id);
      expect(resolved.study.match?.id ?? null).toBe(g.study_id);
      expect(resolved.site.match?.id ?? null).toBe(g.site_id);
      if (resolved.study.match) expect(resolved.study.protocol_match).toBe(g.protocol_match);

      // Mirror the pipeline: match only when sponsor+study resolved (catalog scope).
      const matches =
        resolved.sponsor.match && resolved.study.match
          ? buildMatches(extracted.line_items, proposal, catalogFor(resolved.sponsor.match.id, resolved.study.match.id))
          : [];

      const decision = decide(extracted, resolved, matches, decisionProposal);
      expect(decision.decision).toBe(g.decision);
      const codes = decision.exceptions.map((e) => e.code);
      for (const code of g.exceptions) expect(codes).toContain(code);
    });
  }
});
