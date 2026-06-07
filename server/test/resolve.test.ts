import { describe, it, expect } from "vitest";
import type { EntityResolutionProposal, ExtractedInvoice } from "@ledgerrun/contract";
import { resolveContext, resolveContextFromProposal } from "../src/resolve.js";
import { snapshot } from "./seed.js";

const meta = (m: Partial<ExtractedInvoice["metadata"]>): ExtractedInvoice => ({
  metadata: {
    invoice_number: null,
    invoice_date: null,
    sponsor_name: null,
    study_name: null,
    protocol_number: null,
    site_name: null,
    pi_name: null,
    total_amount: null,
    ...m,
  },
  line_items: [],
});

const proposal = (p: Partial<EntityResolutionProposal>): EntityResolutionProposal => ({
  sponsor: { id: null, confidence: 0, reason: "" },
  study: { id: null, confidence: 0, reason: "" },
  site: { id: null, confidence: 0, reason: "" },
  ...p,
});

describe("resolveContext", () => {
  it("resolves clean metadata confidently (medium invoice)", () => {
    const r = resolveContext(
      meta({
        sponsor_name: "Northwind Pharma",
        study_name: "LUMIN-2024",
        protocol_number: "NWD-LUM-2024-001",
        site_name: "Harborview Medical Institute",
      }),
      snapshot,
    );
    expect(r.sponsor.match?.id).toBe(1);
    expect(r.study.match?.id).toBe(1);
    expect(r.study.protocol_match).toBe(true);
    expect(r.site.match?.id).toBe(2);
    expect(r.sponsor.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it("resolves the simple invoice (Contoso / CATALYST)", () => {
    const r = resolveContext(
      meta({
        sponsor_name: "Contoso Therapeutics",
        study_name: "CATALYST Trial",
        protocol_number: "CON-CAT-2024-101",
        site_name: "Willow Creek Clinical Research Center",
      }),
      snapshot,
    );
    expect(r.sponsor.match?.id).toBe(2);
    expect(r.study.match?.id).toBe(3);
    expect(r.study.protocol_match).toBe(true);
    expect(r.site.match?.id).toBe(1);
  });

  it("flags the mismatched-metadata invoice: off sponsor/site unresolved, wrong protocol year caught", () => {
    const r = resolveContext(
      meta({
        sponsor_name: "Northwind Pharmaceuticals Inc.",
        study_name: "VERITAS Phase 2 Study",
        protocol_number: "NWD-VER-2024-002",
        site_name: "Prairie Clinical Research",
      }),
      snapshot,
    );
    // The "slightly off" sponsor name doesn't clear the bar — surfaced for human pick, real one on top.
    expect(r.sponsor.match).toBeNull();
    expect(r.sponsor.alternatives[0]?.id).toBe(1);
    // The study name fuzzy-matches VERITAS, which exposes the wrong protocol year.
    expect(r.study.match?.id).toBe(2);
    expect(r.study.protocol_match).toBe(false);
    // The site name doesn't match cleanly; the real site is the top alternative.
    expect(r.site.match).toBeNull();
    expect(r.site.alternatives[0]?.id).toBe(6);
  });

  it("scopes study candidates to the resolved sponsor", () => {
    // "AURORA" exists only under Contoso; resolving with Northwind must not pick it.
    const r = resolveContext(
      meta({ sponsor_name: "Northwind Pharma", study_name: "AURORA Extension" }),
      snapshot,
    );
    expect(r.sponsor.match?.id).toBe(1);
    expect(r.study.match).toBeNull();
  });

  it("resolves valid high-confidence LLM entity IDs", () => {
    const r = resolveContextFromProposal(
      meta({
        sponsor_name: "Northwind Pharma",
        study_name: "LUMIN-2024",
        protocol_number: "NWD-LUM-2024-001",
        site_name: "Harborview Medical Institute",
      }),
      snapshot,
      proposal({
        sponsor: { id: 1, confidence: 0.97, reason: "name match" },
        study: { id: 1, confidence: 0.98, reason: "study and protocol match" },
        site: { id: 2, confidence: 0.96, reason: "site match" },
      }),
    );
    expect(r.sponsor.match?.id).toBe(1);
    expect(r.study.match?.id).toBe(1);
    expect(r.study.protocol_match).toBe(true);
    expect(r.site.match?.id).toBe(2);
    expect(r.sponsor.confidence).toBe(0.97);
  });

  it("rejects invalid LLM entity IDs", () => {
    const r = resolveContextFromProposal(
      meta({ sponsor_name: "Northwind Pharma", study_name: "LUMIN-2024", site_name: "Harborview Medical Institute" }),
      snapshot,
      proposal({
        sponsor: { id: 999, confidence: 0.99, reason: "invented" },
        study: { id: 999, confidence: 0.99, reason: "invented" },
        site: { id: 999, confidence: 0.99, reason: "invented" },
      }),
    );
    expect(r.sponsor.match).toBeNull();
    expect(r.study.match).toBeNull();
    expect(r.site.match).toBeNull();
    expect(r.sponsor.alternatives[0]?.id).toBe(1);
  });

  it("rejects low-confidence LLM entity IDs", () => {
    const r = resolveContextFromProposal(
      meta({ sponsor_name: "Northwind Pharma", study_name: "LUMIN-2024", site_name: "Harborview Medical Institute" }),
      snapshot,
      proposal({
        sponsor: { id: 1, confidence: 0.59, reason: "not sure" },
        study: { id: 1, confidence: 0.59, reason: "not sure" },
        site: { id: 2, confidence: 0.59, reason: "not sure" },
      }),
    );
    expect(r.sponsor.match).toBeNull();
    expect(r.study.match).toBeNull();
    expect(r.site.match).toBeNull();
  });

  it("rejects LLM study IDs outside the resolved sponsor", () => {
    const r = resolveContextFromProposal(
      meta({ sponsor_name: "Northwind Pharma", study_name: "AURORA Extension" }),
      snapshot,
      proposal({
        sponsor: { id: 1, confidence: 0.97, reason: "Northwind" },
        study: { id: 4, confidence: 0.97, reason: "AURORA" },
      }),
    );
    expect(r.sponsor.match?.id).toBe(1);
    expect(r.study.match).toBeNull();
  });

  it("keeps conservative metadata validation and protocol checks for LLM proposals", () => {
    const r = resolveContextFromProposal(
      meta({
        sponsor_name: "Northwind Pharmaceuticals Inc.",
        study_name: "VERITAS Phase 2 Study",
        protocol_number: "NWD-VER-2024-002",
        site_name: "Prairie Clinical Research",
      }),
      snapshot,
      proposal({
        sponsor: { id: 1, confidence: 0.99, reason: "model is overconfident about the fuzzy sponsor name" },
        study: { id: 2, confidence: 0.91, reason: "study name match" },
        site: { id: 6, confidence: 0.99, reason: "model is overconfident about the fuzzy site name" },
      }),
    );
    expect(r.sponsor.match).toBeNull();
    expect(r.study.match?.id).toBe(2);
    expect(r.study.protocol_match).toBe(false);
    expect(r.site.match).toBeNull();
  });
});
