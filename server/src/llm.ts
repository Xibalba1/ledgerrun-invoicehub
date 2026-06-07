import Anthropic from "@anthropic-ai/sdk";
import {
  DecisionProposal,
  type DecisionResult,
  EntityResolutionProposal,
  ExtractedInvoice,
  MatchProposal,
  type CatalogItem,
  type ExtractedLineItem,
  type LineItemMatch,
  type ReferenceSnapshot,
  type ResolvedContext,
} from "@ledgerrun/contract";
import { config } from "./config.js";
import { log } from "./logger.js";

// The LLM calls in the pipeline: perception (extract a PDF → structured invoice),
// entity resolution (metadata → reference IDs), and semantic matching (line items
// → catalog). Outputs are untrusted model text, so every response is guarded for
// refusal/truncation and then re-validated against the boundary contract before it
// flows inward.
const client = new Anthropic({ apiKey: config.anthropicKey, maxRetries: config.anthropicMaxRetries });

// Capacity/transient failures from the API (429 rate limit, 529 overloaded, 5xx,
// connection drops) the caller can recover from by simply trying again — distinct
// from a real bug. Carries a message safe to show a reviewer verbatim.
export class LlmBusyError extends Error {
  constructor() {
    super("The AI service is temporarily overloaded. Your changes were saved — please try again in a moment.");
    this.name = "LlmBusyError";
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && typeof err.status === "number" && (err.status === 429 || err.status >= 500);
}

// Single choke point for every model call: the SDK already retried transient
// failures `maxRetries` times with backoff, so reaching this catch means they
// persisted — translate them into a recoverable LlmBusyError for the UI.
async function createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (isTransient(err)) {
      const status = err instanceof Anthropic.APIError ? err.status : "connection";
      log.warn("llm.busy", { status, detail: String(err).slice(0, 200) });
      throw new LlmBusyError();
    }
    throw err;
  }
}

const EXTRACT_SYSTEM =
  "You are an invoice data extractor for a clinical-trials payment platform. " +
  "Read the attached site invoice PDF and return ONLY a JSON object — no prose, no code fences.";

const EXTRACT_INSTRUCTION = `Extract this exact shape:
{
  "metadata": {
    "invoice_number": string|null,
    "invoice_date": string|null,
    "sponsor_name": string|null,
    "study_name": string|null,
    "protocol_number": string|null,
    "site_name": string|null,
    "pi_name": string|null,
    "total_amount": number|null
  },
  "line_items": [
    { "description": string, "quantity": number, "unit_price": number|null, "amount": number|null }
  ]
}
Copy values verbatim from the document; do not normalize names or invent fields. Use null when a field is absent.`;

const MATCH_SYSTEM =
  "You match clinical-trial invoice line items to a sponsor+study billing catalog. " +
  "For each line item, choose the single best catalog entry by meaning (descriptions are often reworded or abbreviated), " +
  "or null when nothing in the catalog plausibly corresponds. Use ONLY item_codes present in the catalog below. " +
  "Give an honest confidence in [0,1]: high (>0.85) for clear matches, low (<0.6) when multiple catalog entries are plausible. " +
  "Do NOT factor unit price into the match — price discrepancies are checked separately. Return ONLY JSON, no prose.";

const ENTITY_SYSTEM =
  "You resolve extracted clinical-trial invoice metadata to reference entities. " +
  "Choose ONLY IDs present in the supplied candidate lists. Use null when no candidate is plausible. " +
  "Use sponsor, study name, protocol number, site name, and PI hints together. Return ONLY JSON, no prose.";

const DECISION_SYSTEM =
  "You make submit-versus-hold decisions for clinical-trial site invoices after extraction, reference resolution, and catalog matching. " +
  "Use the supplied validated signals and deterministic exception candidates. " +
  "Recommend submit only when the context and line-item evidence support automated submission. " +
  "Recommend hold when reviewer QC is prudent. Return ONLY JSON, no prose.";

function guardText(message: Anthropic.Message): string {
  if (message.stop_reason === "refusal") throw new Error("LLM refused the request");
  if (message.stop_reason === "max_tokens") throw new Error("LLM output truncated (max_tokens) — raise the limit");
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error("LLM returned no text content");
  return text;
}

// Models occasionally wrap JSON in prose or code fences; recover the JSON span.
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[{[]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start === -1 || end <= start) throw new Error("LLM response contained no JSON");
  return JSON.parse(body.slice(start, end + 1));
}

export async function extractInvoice(pdf: Buffer): Promise<ExtractedInvoice> {
  const message = await createMessage({
    model: config.model,
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: EXTRACT_INSTRUCTION },
        ],
      },
    ],
  });
  return ExtractedInvoice.parse(parseJson(guardText(message)));
}

export async function resolveEntities(
  extracted: ExtractedInvoice,
  ref: ReferenceSnapshot,
): Promise<EntityResolutionProposal> {
  const sponsors = ref.sponsors.map((s) => `${s.id} | ${s.name} | code ${s.code}`).join("\n");
  const studies = ref.studies
    .map((s) => `${s.id} | sponsor_id ${s.sponsor_id} | ${s.name} | protocol ${s.protocol_number}`)
    .join("\n");
  const sites = ref.sites
    .map((s) => `${s.id} | ${s.name} | PI ${s.pi_name ?? "-"} | ${s.city ?? "-"}, ${s.state ?? "-"}, ${s.country ?? "-"}`)
    .join("\n");

  const message = await createMessage({
    model: config.model,
    max_tokens: 4000,
    thinking: { type: "disabled" },
    system: [
      { type: "text", text: ENTITY_SYSTEM },
      {
        type: "text",
        text:
          `SPONSORS (id | name | code):\n${sponsors}\n\n` +
          `STUDIES (id | sponsor_id | name | protocol):\n${studies}\n\n` +
          `SITES (id | name | PI | location):\n${sites}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Extracted metadata:\n${JSON.stringify(extracted.metadata, null, 2)}\n\n` +
          `Return ONLY this shape:\n` +
          `{"sponsor":{"id":number|null,"confidence":number,"reason":string},` +
          `"study":{"id":number|null,"confidence":number,"reason":string},` +
          `"site":{"id":number|null,"confidence":number,"reason":string}}`,
      },
    ],
  });
  return EntityResolutionProposal.parse(parseJson(guardText(message)));
}

export async function proposeMatches(items: ExtractedLineItem[], catalog: CatalogItem[]): Promise<MatchProposal> {
  const catalogText = catalog
    .map((c) => `${c.item_code} | ${c.description} | ${c.category ?? "-"} | $${c.unit_price ?? "?"}`)
    .join("\n");
  const itemsText = items
    .map((li, i) => `[${i}] ${li.description} | qty ${li.quantity} | unit $${li.unit_price ?? "?"}`)
    .join("\n");

  const message = await createMessage({
    model: config.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: MATCH_SYSTEM },
      // The catalog is the large, reusable prefix — cache it so a second invoice
      // for the same sponsor+study reads it instead of re-paying for it.
      {
        type: "text",
        text: `CATALOG (item_code | description | category | unit_price):\n${catalogText}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content:
          `Extracted line items (index | description | qty | unit price):\n${itemsText}\n\n` +
          `Return ONLY: {"matches":[{"line_index":number,"item_code":string|null,"confidence":number,"reason":string}]} ` +
          `with exactly one entry per line index above.`,
      },
    ],
  });
  return MatchProposal.parse(parseJson(guardText(message)));
}

export function decisionPromptPayload(
  extracted: ExtractedInvoice,
  resolved: ResolvedContext,
  matches: LineItemMatch[],
  draft: DecisionResult,
) {
  return {
    extracted_metadata: extracted.metadata,
    resolved_context: {
      sponsor: {
        id: resolved.sponsor.match?.id ?? null,
        name: resolved.sponsor.match?.name ?? null,
        confidence: resolved.sponsor.confidence,
      },
      study: {
        id: resolved.study.match?.id ?? null,
        name: resolved.study.match?.name ?? null,
        protocol_number: resolved.study.match?.protocol_number ?? null,
        confidence: resolved.study.confidence,
        protocol_match: resolved.study.protocol_match,
      },
      site: {
        id: resolved.site.match?.id ?? null,
        name: resolved.site.match?.name ?? null,
        confidence: resolved.site.confidence,
      },
    },
    matches: matches.map((m, line_index) => ({
      line_index,
      description: m.line.description,
      quantity: m.line.quantity,
      unit_price: m.line.unit_price ?? null,
      amount: m.line.amount ?? null,
      catalog_item_code: m.catalog_item?.item_code ?? null,
      catalog_description: m.catalog_item?.description ?? null,
      catalog_unit_price: m.catalog_item?.unit_price ?? null,
      confidence: m.confidence,
      status: m.status,
      price_delta: m.price_delta,
      match_reason: m.reason,
    })),
    deterministic_policy: draft,
  };
}

export async function proposeDecision(
  extracted: ExtractedInvoice,
  resolved: ResolvedContext,
  matches: LineItemMatch[],
  draft: DecisionResult,
): Promise<DecisionProposal> {
  const message = await createMessage({
    model: config.model,
    max_tokens: 4000,
    thinking: { type: "disabled" },
    system: DECISION_SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Validated decision inputs:\n${JSON.stringify(decisionPromptPayload(extracted, resolved, matches, draft), null, 2)}\n\n` +
          `Return ONLY this shape:\n` +
          `{"decision":"submit"|"hold","rationale":string,"confidence":number,` +
          `"exception_codes":["metadata_unresolved"|"protocol_mismatch"|"unmatched_line_items"|"price_mismatch"|` +
          `"low_confidence_match"|"total_mismatch"|"ai_review_recommended"],"warnings":[string]}`,
      },
    ],
  });
  return DecisionProposal.parse(parseJson(guardText(message)));
}

export const llmConfigured = () => config.anthropicKey.length > 0;
