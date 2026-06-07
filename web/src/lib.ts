import type { InvoiceRecord, InvoiceStatus, MatchStatus, Stage, ExceptionCode } from "@ledgerrun/contract";

export const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const STATUS_TONE: Record<InvoiceStatus, string> = {
  processing: "border-accent/40 bg-accent/10 text-accent",
  submitted: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  held: "border-accent-amber/50 bg-accent-amber/10 text-accent-amber",
  failed: "border-accent-red/40 bg-accent-red/10 text-accent-red",
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  processing: "Processing",
  submitted: "Submitted",
  held: "Held for QC",
  failed: "Failed",
};

export const MATCH_TONE: Record<MatchStatus, string> = {
  matched: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  price_mismatch: "border-accent-amber/50 bg-accent-amber/10 text-accent-amber",
  low_confidence: "border-accent-amber/50 bg-accent-amber/10 text-accent-amber",
  unmatched: "border-accent-red/40 bg-accent-red/10 text-accent-red",
};

export const MATCH_LABEL: Record<MatchStatus, string> = {
  matched: "matched",
  price_mismatch: "price mismatch",
  low_confidence: "ambiguous",
  unmatched: "unmatched",
};

export const sourceLabel = (rec: InvoiceRecord) =>
  rec.source.email ? rec.source.email.subject : rec.source.filename;

export const sourceUrl = (rec: InvoiceRecord) => `/api/invoices/${rec.id}/source`;

/** The headline fact about an invoice: what it's worth. Null until extracted. */
export const invoiceTotal = (rec: InvoiceRecord): number | null =>
  rec.extracted?.metadata.total_amount ?? null;

export const STAGE_LABEL: Record<Stage, string> = {
  received: "Queued",
  extracting: "Reading invoice",
  resolving: "Resolving context",
  matching: "Matching line items",
  deciding: "Deciding",
  done: "Done",
  failed: "Failed",
};

// Exception codes humanized two ways: a one-word tag for dense card chips, a
// full title for the detail's "what's blocking" list.
export const EXCEPTION_SHORT: Record<ExceptionCode, string> = {
  metadata_unresolved: "context",
  protocol_mismatch: "protocol",
  unmatched_line_items: "unmatched items",
  price_mismatch: "price",
  low_confidence_match: "low confidence",
  total_mismatch: "total",
};

export const EXCEPTION_TITLE: Record<ExceptionCode, string> = {
  metadata_unresolved: "Unresolved context",
  protocol_mismatch: "Protocol mismatch",
  unmatched_line_items: "Unmatched line items",
  price_mismatch: "Price mismatch",
  low_confidence_match: "Low-confidence match",
  total_mismatch: "Total mismatch",
};

/** The blockers a human must clear before a held invoice can submit. */
export function blockerSummary(rec: InvoiceRecord): { count: number; label: string } {
  const blocks = rec.decision?.exceptions.filter((e) => e.severity === "block") ?? [];
  return { count: blocks.length, label: blocks.map((e) => EXCEPTION_SHORT[e.code]).slice(0, 2).join(", ") };
}

/** Dollars waiting on the reviewer — the stakes of the queue, summed. */
export const queueValue = (invoices: InvoiceRecord[]): number =>
  invoices.reduce((s, i) => s + (invoiceTotal(i) ?? 0), 0);

export function relativeTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Assumed minutes of manual triage saved per invoice the AI cleared on its own —
// the unit behind the "time saved" heartbeat (the PRD's headline impact metric).
export const MINUTES_PER_INVOICE = 12;

export interface Lanes {
  needsYou: InvoiceRecord[];
  inFlight: InvoiceRecord[];
  escalated: InvoiceRecord[];
  cleared: InvoiceRecord[];
}

const blockingCount = (rec: InvoiceRecord) =>
  rec.decision?.exceptions.filter((e) => e.severity === "block").length ?? 0;

/** Split the queue by what the human must do: triage held/failed, watch in-flight, track escalated, trust cleared. */
export function partitionLanes(invoices: InvoiceRecord[]): Lanes {
  const escalated = invoices.filter((i) => i.escalated);
  const needsYou = invoices
    .filter((i) => !i.escalated && (i.status === "held" || i.status === "failed"))
    .sort((a, b) => blockingCount(a) - blockingCount(b)); // closest-to-clearing first
  const inFlight = invoices.filter((i) => i.status === "processing");
  const cleared = invoices.filter((i) => !i.escalated && i.status === "submitted");
  return { needsYou, inFlight, escalated, cleared };
}

/** Why an invoice was handed off — the reason captured at escalation time. */
export const escalationReason = (rec: InvoiceRecord): string | null =>
  rec.qc_actions.filter((a) => a.type === "escalate").at(-1)?.detail ?? null;

export interface Stats {
  processed: number;
  autoSubmitted: number;
  autoRate: number;
  minutesSaved: number;
  avgLatencyMs: number;
}

export function computeStats(invoices: InvoiceRecord[]): Stats {
  const done = invoices.filter((i) => i.status === "submitted" || i.status === "held");
  const autoSubmitted = invoices.filter((i) => i.status === "submitted" && i.submitted_by === "ai").length;
  const latencies = done
    .map((i) => Object.values(i.timings).reduce((s, n) => s + n, 0))
    .filter((n) => n > 0);
  return {
    processed: done.length,
    autoSubmitted,
    autoRate: done.length ? autoSubmitted / done.length : 0,
    minutesSaved: autoSubmitted * MINUTES_PER_INVOICE,
    avgLatencyMs: latencies.length ? latencies.reduce((s, n) => s + n, 0) / latencies.length : 0,
  };
}

// Confidence as a visual signal, not a bare number: green when trusted, amber in
// the grey zone (matches resolve.ts ACCEPT = 0.6), red when the field didn't resolve.
export function confidenceTone(score: number): string {
  if (score >= 0.85) return "text-accent-green";
  if (score >= 0.6) return "text-accent-amber";
  return "text-accent-red";
}
