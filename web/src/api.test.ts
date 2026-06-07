import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "@ledgerrun/contract";
import { api } from "./api";

const invoice = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: "inv-1",
  created_at: "2026-06-07T00:00:00.000Z",
  source: { kind: "pdf", filename: "invoice.pdf", email: null },
  status: "held",
  stage: "done",
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

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function textResponse(body: string, status = 200) {
  return Promise.resolve(new Response(body, { status, headers: { "content-type": "text/plain" } }));
}

describe("web API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses invoice lists against the shared contract", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([invoice()])) as typeof fetch);

    await expect(api.list()).resolves.toEqual([invoice()]);
    expect(fetch).toHaveBeenCalledWith("/api/invoices");
  });

  it("rejects malformed invoice payloads before they reach the UI", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([{ id: "missing required fields" }])) as typeof fetch);

    await expect(api.list()).rejects.toThrow();
  });

  it("surfaces non-OK JSON errors for upload and actions", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ error: "ANTHROPIC_API_KEY is not set" }, 503)) as typeof fetch);

    await expect(api.upload(new File(["%PDF"], "invoice.pdf", { type: "application/pdf" }))).rejects.toThrow(
      "ANTHROPIC_API_KEY is not set",
    );
    await expect(api.action("inv-1", { type: "submit" })).rejects.toThrow("ANTHROPIC_API_KEY is not set");
  });

  it("surfaces plain-text demo seed failures without leaking JSON parse errors", async () => {
    vi.stubGlobal("fetch", vi.fn(() => textResponse("Internal Server Error", 500)) as typeof fetch);

    await expect(api.demoSeed()).rejects.toThrow("request failed (500)");
  });

  it("parses successful action responses as invoice records", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(invoice({ status: "submitted", submitted_by: "human" }))) as typeof fetch);

    await expect(api.action("inv-1", { type: "submit" })).resolves.toMatchObject({
      id: "inv-1",
      status: "submitted",
      submitted_by: "human",
    });
  });
});
