import { describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "@ledgerrun/contract";
import {
  blockerSummary,
  computeStats,
  confidenceTone,
  escalationReason,
  invoiceTotal,
  money,
  partitionLanes,
  pct,
  queueValue,
  relativeTime,
  sourceLabel,
  sourceUrl,
} from "./lib";

const invoice = (id: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id,
  created_at: "2026-06-07T12:00:00.000Z",
  source: { kind: "pdf", filename: `${id}.pdf`, email: null },
  status: "processing",
  stage: "received",
  extracted: null,
  resolved: null,
  matches: null,
  decision: null,
  escalated: false,
  submitted_by: null,
  error: null,
  qc_actions: [],
  timings: {},
  ...overrides,
});

describe("web lib", () => {
  it("formats basic display values", () => {
    const rec = invoice("inv-1", {
      source: {
        kind: "eml",
        filename: "mail.eml",
        email: { from: "site@example.test", subject: "June invoice", date: "2026-06-01T00:00:00.000Z" },
      },
      extracted: {
        metadata: {
          invoice_number: "INV-1",
          invoice_date: "2026-06-01",
          sponsor_name: null,
          study_name: null,
          protocol_number: null,
          site_name: null,
          pi_name: null,
          total_amount: 1234.5,
        },
        line_items: [],
      },
    });

    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(null)).toBe("—");
    expect(pct(0.876)).toBe("88%");
    expect(sourceLabel(rec)).toBe("June invoice");
    expect(sourceUrl(rec)).toBe("/api/invoices/inv-1/source");
    expect(invoiceTotal(rec)).toBe(1234.5);
  });

  it("summarizes blockers and queue value", () => {
    const held = invoice("held", {
      status: "held",
      decision: {
        decision: "hold",
        rationale: "Held",
        exceptions: [
          { code: "metadata_unresolved", severity: "block", message: "missing" },
          { code: "price_mismatch", severity: "block", message: "price" },
          { code: "total_mismatch", severity: "warn", message: "total" },
        ],
      },
      extracted: {
        metadata: {
          invoice_number: "INV",
          invoice_date: null,
          sponsor_name: null,
          study_name: null,
          protocol_number: null,
          site_name: null,
          pi_name: null,
          total_amount: 500,
        },
        line_items: [],
      },
    });

    expect(blockerSummary(held)).toEqual({ count: 2, label: "context, price" });
    expect(queueValue([held, invoice("empty")])).toBe(500);
  });

  it("partitions lanes by workflow responsibility", () => {
    const held = invoice("held", { status: "held", decision: { decision: "hold", rationale: "", exceptions: [] } });
    const processing = invoice("processing", { status: "processing" });
    const submitted = invoice("submitted", { status: "submitted", submitted_by: "ai" });
    const escalated = invoice("escalated", { status: "held", escalated: true });
    const failed = invoice("failed", { status: "failed", stage: "failed" });

    const lanes = partitionLanes([submitted, processing, escalated, held, failed]);

    expect(lanes.needsYou.map((i) => i.id)).toEqual(["held", "failed"]);
    expect(lanes.inFlight.map((i) => i.id)).toEqual(["processing"]);
    expect(lanes.escalated.map((i) => i.id)).toEqual(["escalated"]);
    expect(lanes.cleared.map((i) => i.id)).toEqual(["submitted"]);
  });

  it("computes operating stats", () => {
    const stats = computeStats([
      invoice("ai", { status: "submitted", submitted_by: "ai", timings: { extract: 100, match: 200 } }),
      invoice("human", { status: "submitted", submitted_by: "human", timings: { extract: 50 } }),
      invoice("held", { status: "held", timings: { extract: 250 } }),
      invoice("processing", { status: "processing" }),
    ]);

    expect(stats).toEqual({
      processed: 3,
      autoSubmitted: 1,
      autoRate: 1 / 3,
      minutesSaved: 12,
      avgLatencyMs: 200,
    });
  });

  it("returns escalation reason and confidence tone", () => {
    const rec = invoice("esc", {
      qc_actions: [
        { id: "1", at: "2026-06-07T12:01:00.000Z", type: "note", by: "reviewer", detail: "note" },
        { id: "2", at: "2026-06-07T12:02:00.000Z", type: "escalate", by: "reviewer", detail: "contract issue" },
      ],
    });

    expect(escalationReason(rec)).toBe("contract issue");
    expect(confidenceTone(0.9)).toBe("text-accent-green");
    expect(confidenceTone(0.7)).toBe("text-accent-amber");
    expect(confidenceTone(0.2)).toBe("text-accent-red");
  });

  it("formats relative time buckets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));

    expect(relativeTime("2026-06-07T11:59:40.000Z")).toBe("just now");
    expect(relativeTime("2026-06-07T11:15:00.000Z")).toBe("45m ago");
    expect(relativeTime("2026-06-07T08:00:00.000Z")).toBe("4h ago");
    expect(relativeTime("2026-06-05T12:00:00.000Z")).toBe("2d ago");

    vi.useRealTimers();
  });
});
