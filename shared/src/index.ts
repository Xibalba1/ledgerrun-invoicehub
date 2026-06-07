import { z } from "zod";

/**
 * The boundary contract: the single source of truth at every seam — the LLM's
 * extraction/matching output, the reference API (via MCP), and the HTTP API
 * between server and web. Untrusted payloads are parsed against these before
 * they flow inward; the web validates API responses against the same shapes.
 */

// ── Reference entities (mirror the read-only reference API) ──────────────────

export const Money = z.coerce.number(); // API serializes Decimal as "450.00"

export const Sponsor = z.object({ id: z.number().int(), name: z.string(), code: z.string() });
export const Study = z.object({
  id: z.number().int(),
  sponsor_id: z.number().int(),
  name: z.string(),
  protocol_number: z.string(),
  phase: z.string().nullish(),
  therapeutic_area: z.string().nullish(),
});
export const Site = z.object({
  id: z.number().int(),
  name: z.string(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  pi_name: z.string().nullish(),
});
export const CatalogItem = z.object({
  id: z.number().int(),
  sponsor_id: z.number().int(),
  study_id: z.number().int(),
  item_code: z.string(),
  description: z.string(),
  category: z.string().nullish(),
  unit_price: Money.nullish(),
});

export type Sponsor = z.infer<typeof Sponsor>;
export type Study = z.infer<typeof Study>;
export type Site = z.infer<typeof Site>;
export type CatalogItem = z.infer<typeof CatalogItem>;

export const ReferenceSnapshot = z.object({
  sponsors: z.array(Sponsor),
  studies: z.array(Study),
  sites: z.array(Site),
});
export type ReferenceSnapshot = z.infer<typeof ReferenceSnapshot>;

// ── Stage 1: extraction (untrusted LLM output) ───────────────────────────────

export const ExtractedLineItem = z.object({
  description: z.string(),
  quantity: z.coerce.number().default(1),
  unit_price: z.coerce.number().nullish(),
  amount: z.coerce.number().nullish(),
});
export const ExtractedInvoice = z.object({
  metadata: z.object({
    invoice_number: z.string().nullish(),
    invoice_date: z.string().nullish(),
    sponsor_name: z.string().nullish(),
    study_name: z.string().nullish(),
    protocol_number: z.string().nullish(),
    site_name: z.string().nullish(),
    pi_name: z.string().nullish(),
    total_amount: z.coerce.number().nullish(),
  }),
  line_items: z.array(ExtractedLineItem),
});
export type ExtractedLineItem = z.infer<typeof ExtractedLineItem>;
export type ExtractedInvoice = z.infer<typeof ExtractedInvoice>;

// ── Stage 2: metadata resolution (LLM proposal, validated over MCP candidates) ─

export const EntityResolutionChoice = z.object({
  id: z.number().int().nullable(),
  confidence: z.number(),
  reason: z.string(),
});
export const EntityResolutionProposal = z.object({
  sponsor: EntityResolutionChoice,
  study: EntityResolutionChoice,
  site: EntityResolutionChoice,
});
export type EntityResolutionProposal = z.infer<typeof EntityResolutionProposal>;

export const Candidate = z.object({ id: z.number().int(), name: z.string(), score: z.number() });
export type Candidate = z.infer<typeof Candidate>;
export const SponsorResolution = z.object({
  match: Sponsor.nullable(),
  confidence: z.number(),
  alternatives: z.array(Candidate),
});
export const StudyResolution = z.object({
  match: Study.nullable(),
  confidence: z.number(),
  alternatives: z.array(Candidate),
  protocol_match: z.boolean().nullable(), // null when no study matched
});
export const SiteResolution = z.object({
  match: Site.nullable(),
  confidence: z.number(),
  alternatives: z.array(Candidate),
});
export const ResolvedContext = z.object({
  sponsor: SponsorResolution,
  study: StudyResolution,
  site: SiteResolution,
});
export type ResolvedContext = z.infer<typeof ResolvedContext>;

// ── Stage 3: line-item matching (LLM proposal + deterministic post-processing) ─

export const MatchStatus = z.enum(["matched", "price_mismatch", "low_confidence", "unmatched"]);
export const LineItemMatch = z.object({
  line: ExtractedLineItem,
  catalog_item: CatalogItem.nullable(),
  confidence: z.number(),
  reason: z.string(),
  price_delta: z.number().nullable(), // invoice unit_price − catalog unit_price
  status: MatchStatus,
});
export type MatchStatus = z.infer<typeof MatchStatus>;
export type LineItemMatch = z.infer<typeof LineItemMatch>;

/** What the LLM returns for matching — indices into the line-item list. */
export const MatchProposal = z.object({
  matches: z.array(
    z.object({
      line_index: z.number().int(),
      item_code: z.string().nullable(), // null = no catalog match
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});
export type MatchProposal = z.infer<typeof MatchProposal>;

// ── Stage 4: decision (LLM proposal + deterministic safety reconciliation) ───

export const ExceptionCode = z.enum([
  "metadata_unresolved",
  "protocol_mismatch",
  "unmatched_line_items",
  "price_mismatch",
  "low_confidence_match",
  "total_mismatch",
  "ai_review_recommended",
]);
export const Exception = z.object({
  code: ExceptionCode,
  severity: z.enum(["block", "warn"]),
  message: z.string(),
});
export const Decision = z.enum(["submit", "hold"]);
export const DecisionProposal = z.object({
  decision: Decision,
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  exception_codes: z.array(ExceptionCode).default([]),
  warnings: z.array(z.string()).default([]),
});
export const DecisionResult = z.object({
  decision: Decision,
  rationale: z.string(),
  exceptions: z.array(Exception),
});
export type ExceptionCode = z.infer<typeof ExceptionCode>;
export type Exception = z.infer<typeof Exception>;
export type Decision = z.infer<typeof Decision>;
export type DecisionProposal = z.infer<typeof DecisionProposal>;
export type DecisionResult = z.infer<typeof DecisionResult>;

// ── Persisted invoice record / pipeline state (observable) ───────────────────

export const Stage = z.enum(["received", "extracting", "resolving", "matching", "deciding", "done", "failed"]);
export const InvoiceStatus = z.enum(["processing", "submitted", "held", "failed"]);

export const QcAction = z.object({
  id: z.string(),
  at: z.string(),
  type: z.enum(["correct_metadata", "correct_match", "rerun", "escalate", "submit", "note"]),
  by: z.string(),
  detail: z.string(),
});
export type QcAction = z.infer<typeof QcAction>;

export const InvoiceRecord = z.object({
  id: z.string(),
  created_at: z.string(),
  source: z.object({
    kind: z.enum(["eml", "pdf"]),
    filename: z.string(),
    email: z.object({ from: z.string(), subject: z.string(), date: z.string() }).nullable(),
  }),
  status: InvoiceStatus,
  stage: Stage,
  extracted: ExtractedInvoice.nullable(),
  resolved: ResolvedContext.nullable(),
  matches: z.array(LineItemMatch).nullable(),
  decision: DecisionResult.nullable(),
  escalated: z.boolean(),
  submitted_by: z.enum(["ai", "human"]).nullable(),
  error: z.string().nullable(),
  qc_actions: z.array(QcAction),
  timings: z.record(z.number()),
});
export type Stage = z.infer<typeof Stage>;
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;
export type InvoiceRecord = z.infer<typeof InvoiceRecord>;

// ── HTTP API shapes ──────────────────────────────────────────────────────────

export const InvoiceList = z.array(InvoiceRecord);

export const ActionRequest = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("correct_metadata"),
    sponsor_id: z.number().int().nullish(),
    study_id: z.number().int().nullish(),
    site_id: z.number().int().nullish(),
  }),
  z.object({
    type: z.literal("correct_match"),
    line_index: z.number().int(),
    item_code: z.string().nullable(), // null = mark unmatched
  }),
  z.object({ type: z.literal("rerun") }),
  z.object({ type: z.literal("escalate"), reason: z.string().min(1) }),
  z.object({ type: z.literal("submit") }),
  z.object({ type: z.literal("note"), detail: z.string() }),
]);
export type ActionRequest = z.infer<typeof ActionRequest>;
