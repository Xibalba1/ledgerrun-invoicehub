import type { CatalogItem, ExtractedLineItem, LineItemMatch, MatchProposal, MatchStatus } from "@ledgerrun/contract";

// A matched item below this confidence is treated as ambiguous (the "multiple
// possible matches" case) → flagged for human review.
export const LOW_CONFIDENCE = 0.6;
// Unit-price tolerance before a matched item is flagged as a price mismatch.
export const PRICE_TOLERANCE = 0.005;

/**
 * Turn the LLM's match proposal into validated, post-processed matches. Pure and
 * deterministic given the proposal: price comparison, confidence thresholding,
 * and unmatched detection all happen here (not in the model), so the resulting
 * exceptions are auditable and the decision is replayable offline.
 */
export function buildMatches(
  lineItems: ExtractedLineItem[],
  proposal: MatchProposal,
  catalog: CatalogItem[],
): LineItemMatch[] {
  const byCode = new Map(catalog.map((c) => [c.item_code, c]));
  const byIndex = new Map(proposal.matches.map((m) => [m.line_index, m]));

  return lineItems.map((line, i) => {
    const p = byIndex.get(i);
    const catalogItem = p?.item_code ? byCode.get(p.item_code) ?? null : null;
    return classifyMatch(line, catalogItem, p ? p.confidence : 0, p?.reason ?? "No proposal returned for this line.");
  });
}

/** Classify one line ↔ catalog pairing into a status + price delta. Pure; reused by QC corrections. */
export function classifyMatch(
  line: ExtractedLineItem,
  catalogItem: CatalogItem | null,
  confidence: number,
  reason: string,
): LineItemMatch {
  const c = clamp(confidence);
  if (!catalogItem) return { line, catalog_item: null, confidence: c, reason, price_delta: null, status: "unmatched" };

  const price_delta =
    line.unit_price != null && catalogItem.unit_price != null ? round(line.unit_price - catalogItem.unit_price) : null;

  let status: MatchStatus = "matched";
  if (price_delta != null && Math.abs(price_delta) > PRICE_TOLERANCE) status = "price_mismatch";
  else if (c < LOW_CONFIDENCE) status = "low_confidence";

  return { line, catalog_item: catalogItem, confidence: c, reason, price_delta, status };
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 100) / 100;
