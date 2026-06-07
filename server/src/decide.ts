import type { DecisionResult, Exception, LineItemMatch, ResolvedContext, ExtractedInvoice } from "@ledgerrun/contract";

// Stated-total vs summed-line-amounts tolerance (a soft, warn-only check).
const TOTAL_TOLERANCE = 0.5;

/**
 * The decision policy: a transparent, deterministic rule over the AI-derived
 * signals (resolution confidence, per-line match status, protocol check). The
 * model does perception (extract + match); this does policy. Any `block`
 * exception holds the invoice; otherwise it submits. The exceptions list IS the
 * explanation shown in the hub — "why it was held" is never a black box.
 */
export function decide(
  extracted: ExtractedInvoice,
  resolved: ResolvedContext,
  matches: LineItemMatch[],
): DecisionResult {
  const exceptions: Exception[] = [];

  const missing: string[] = [];
  if (!resolved.sponsor.match) missing.push("sponsor");
  if (!resolved.study.match) missing.push("study");
  if (!resolved.site.match) missing.push("site");
  if (missing.length) {
    exceptions.push({
      code: "metadata_unresolved",
      severity: "block",
      message: `Could not confidently resolve ${missing.join(", ")} — needs human selection.`,
    });
  }

  if (resolved.study.protocol_match === false) {
    exceptions.push({
      code: "protocol_mismatch",
      severity: "block",
      message: `Invoice protocol "${extracted.metadata.protocol_number}" does not match resolved study "${resolved.study.match?.protocol_number}".`,
    });
  }

  const unmatched = matches.filter((m) => m.status === "unmatched");
  if (unmatched.length) {
    exceptions.push({
      code: "unmatched_line_items",
      severity: "block",
      message: `${unmatched.length} line item(s) have no catalog match: ${unmatched.map((m) => `"${m.line.description}"`).join(", ")}.`,
    });
  }

  const priceMismatch = matches.filter((m) => m.status === "price_mismatch");
  if (priceMismatch.length) {
    exceptions.push({
      code: "price_mismatch",
      severity: "block",
      message: priceMismatch
        .map((m) => `"${m.line.description}" billed ${fmt(m.line.unit_price)} vs catalog ${fmt(m.catalog_item?.unit_price)} (Δ ${fmt(m.price_delta)})`)
        .join("; "),
    });
  }

  const lowConfidence = matches.filter((m) => m.status === "low_confidence");
  if (lowConfidence.length) {
    exceptions.push({
      code: "low_confidence_match",
      severity: "block",
      message: `${lowConfidence.length} ambiguous match(es) below confidence threshold: ${lowConfidence.map((m) => `"${m.line.description}"`).join(", ")}.`,
    });
  }

  const total = extracted.metadata.total_amount;
  if (total != null) {
    const summed = matches.reduce((s, m) => s + (m.line.amount ?? 0), 0);
    if (Math.abs(summed - total) > TOTAL_TOLERANCE) {
      exceptions.push({
        code: "total_mismatch",
        severity: "warn",
        message: `Line items sum to ${fmt(summed)} but invoice total is ${fmt(total)}.`,
      });
    }
  }

  const blocking = exceptions.filter((e) => e.severity === "block");
  const decision = blocking.length === 0 ? "submit" : "hold";
  const rationale =
    decision === "submit"
      ? `All ${matches.length} line items matched to the confirmed catalog within tolerance; metadata resolved confidently. Auto-submitted.`
      : `Held for QC: ${blocking.map((e) => e.code).join(", ")}.`;

  return { decision, rationale, exceptions };
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
