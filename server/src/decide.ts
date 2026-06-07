import type {
  DecisionProposal,
  DecisionResult,
  Exception,
  LineItemMatch,
  ResolvedContext,
  ExtractedInvoice,
} from "@ledgerrun/contract";

// Stated-total vs summed-line-amounts tolerance (a soft, warn-only check).
const TOTAL_TOLERANCE = 0.5;

export function decide(
  extracted: ExtractedInvoice,
  resolved: ResolvedContext,
  matches: LineItemMatch[],
  proposal: DecisionProposal | null = null,
): DecisionResult {
  return reconcileDecision(buildDecisionDraft(extracted, resolved, matches), proposal);
}

/**
 * Deterministic policy over validated AI-derived signals. This builds the
 * canonical exception list; reconciliation may let the model explain or hold,
 * but never submit through a deterministic blocker.
 */
export function buildDecisionDraft(
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

export function reconcileDecision(draft: DecisionResult, proposal: DecisionProposal | null = null): DecisionResult {
  if (!proposal) return draft;

  const blocking = draft.exceptions.filter((e) => e.severity === "block");
  if (blocking.length) {
    return {
      decision: "hold",
      rationale:
        proposal.decision === "hold"
          ? proposal.rationale
          : `Held for QC despite the AI submit recommendation: ${blocking.map((e) => e.code).join(", ")}.`,
      exceptions: draft.exceptions,
    };
  }

  if (proposal.decision === "hold") {
    return {
      decision: "hold",
      rationale: proposal.rationale,
      exceptions: [
        ...draft.exceptions,
        {
          code: "ai_review_recommended",
          severity: "block",
          message: proposal.rationale,
        },
      ],
    };
  }

  return {
    decision: "submit",
    rationale: proposal.rationale,
    exceptions: draft.exceptions,
  };
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
