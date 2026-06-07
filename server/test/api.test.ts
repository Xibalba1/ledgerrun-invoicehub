import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "@ledgerrun/contract";

const mocks = vi.hoisted(() => ({
  llmConfigured: vi.fn(() => true),
  fetchReferenceSnapshot: vi.fn(),
  fetchCatalog: vi.fn(),
  ingest: vi.fn(),
  newInvoice: vi.fn(),
  runPipeline: vi.fn(),
  applyAction: vi.fn(),
  seedDemo: vi.fn(async () => ["demo-1", "demo-2"]),
  savePdf: vi.fn(),
  loadPdf: vi.fn(),
  clearPdfs: vi.fn(),
  getInvoice: vi.fn(),
  listInvoices: vi.fn(),
  clearInvoices: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("../src/llm.js", () => ({
  LlmBusyError: class LlmBusyError extends Error {
    constructor() {
      super("The AI service is temporarily overloaded. Your changes were saved — please try again in a moment.");
      this.name = "LlmBusyError";
    }
  },
  llmConfigured: mocks.llmConfigured,
}));
vi.mock("../src/mcp/client.js", () => ({
  fetchReferenceSnapshot: mocks.fetchReferenceSnapshot,
  fetchCatalog: mocks.fetchCatalog,
}));
vi.mock("../src/ingest.js", () => ({ ingest: mocks.ingest }));
vi.mock("../src/pipeline.js", () => ({
  newInvoice: mocks.newInvoice,
  runPipeline: mocks.runPipeline,
  applyAction: mocks.applyAction,
}));
vi.mock("../src/replay.js", () => ({ seedDemo: mocks.seedDemo }));
vi.mock("../src/storage.js", () => ({
  savePdf: mocks.savePdf,
  loadPdf: mocks.loadPdf,
  clearPdfs: mocks.clearPdfs,
}));
vi.mock("../src/db.js", () => ({
  getInvoice: mocks.getInvoice,
  listInvoices: mocks.listInvoices,
  clearInvoices: mocks.clearInvoices,
}));
vi.mock("../src/events.js", () => ({ subscribe: mocks.subscribe }));
vi.mock("../src/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const baseInvoice = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: "inv-1",
  created_at: "2026-06-07T00:00:00.000Z",
  source: { kind: "pdf", filename: "invoice.pdf", email: null },
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

async function app() {
  return (await import("../src/api.js")).app;
}

describe("HTTP API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.llmConfigured.mockReturnValue(true);
    mocks.listInvoices.mockReturnValue([baseInvoice()]);
    mocks.getInvoice.mockImplementation((id: string) => (id === "inv-1" ? baseInvoice() : null));
    mocks.fetchReferenceSnapshot.mockResolvedValue({ sponsors: [], studies: [], sites: [] });
    mocks.fetchCatalog.mockResolvedValue([{ id: 1, sponsor_id: 1, study_id: 1, item_code: "VISIT-SCR", description: "Screening", unit_price: 450 }]);
    mocks.ingest.mockResolvedValue({ pdf: Buffer.from("%PDF"), source: { kind: "pdf", filename: "invoice.pdf", email: null } });
    mocks.newInvoice.mockReturnValue(baseInvoice());
    mocks.seedDemo.mockResolvedValue(["demo-1", "demo-2"]);
    mocks.applyAction.mockResolvedValue(baseInvoice({ status: "submitted", submitted_by: "human" }));
    mocks.loadPdf.mockReturnValue(Buffer.from("%PDF"));
  });

  it("reports health with LLM readiness", async () => {
    const res = await (await app()).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, llm: true });
  });

  it("lists, fetches, and 404s invoices", async () => {
    const a = await app();
    expect(await (await a.request("/api/invoices")).json()).toHaveLength(1);
    expect(await (await a.request("/api/invoices/inv-1")).json()).toMatchObject({ id: "inv-1" });
    const missing = await a.request("/api/invoices/nope");
    expect(missing.status).toBe(404);
  });

  it("validates catalog query parameters", async () => {
    const a = await app();
    expect((await a.request("/api/catalog")).status).toBe(400);
    const ok = await a.request("/api/catalog?sponsor_id=1&study_id=1");
    expect(ok.status).toBe(200);
    expect(mocks.fetchCatalog).toHaveBeenCalledWith(1, 1);
  });

  it("serves source PDFs only for known invoices with stored source", async () => {
    const a = await app();
    const ok = await a.request("/api/invoices/inv-1/source");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");

    expect((await a.request("/api/invoices/nope/source")).status).toBe(404);
    mocks.loadPdf.mockImplementationOnce(() => {
      throw new Error("missing");
    });
    expect((await a.request("/api/invoices/inv-1/source")).status).toBe(404);
  });

  it("rejects uploads without a file or without LLM configuration", async () => {
    const a = await app();
    expect((await a.request("/api/invoices", { method: "POST", body: new FormData() })).status).toBe(400);

    mocks.llmConfigured.mockReturnValueOnce(false);
    const body = new FormData();
    body.append("file", new File([Buffer.from("%PDF")], "invoice.pdf", { type: "application/pdf" }));
    const res = await a.request("/api/invoices", { method: "POST", body });
    expect(res.status).toBe(503);
  });

  it("ingests uploads and starts the async pipeline", async () => {
    const body = new FormData();
    body.append("file", new File([Buffer.from("%PDF")], "invoice.pdf", { type: "application/pdf" }));

    const res = await (await app()).request("/api/invoices", { method: "POST", body });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ id: "inv-1" });
    expect(mocks.ingest).toHaveBeenCalledWith(expect.any(Buffer), "invoice.pdf");
    expect(mocks.savePdf).toHaveBeenCalledWith("inv-1", Buffer.from("%PDF"));
    expect(mocks.runPipeline).toHaveBeenCalledWith("inv-1", Buffer.from("%PDF"));
  });

  it("returns bad request when ingest fails", async () => {
    mocks.ingest.mockRejectedValueOnce(new Error("No PDF attachment"));
    const body = new FormData();
    body.append("file", new File([Buffer.from("email")], "invoice.eml", { type: "message/rfc822" }));

    const res = await (await app()).request("/api/invoices", { method: "POST", body });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Error: No PDF attachment" });
  });

  it("seeds and resets demo state", async () => {
    const a = await app();
    expect(await (await a.request("/api/demo/seed", { method: "POST" })).json()).toEqual({ ids: ["demo-1", "demo-2"] });

    const reset = await a.request("/api/demo/reset", { method: "POST" });
    expect(reset.status).toBe(200);
    expect(mocks.clearInvoices).toHaveBeenCalledOnce();
    expect(mocks.clearPdfs).toHaveBeenCalledOnce();
  });

  it("returns JSON for unhandled API errors", async () => {
    mocks.seedDemo.mockRejectedValueOnce(new Error("missing demo fixture"));

    const res = await (await app()).request("/api/demo/seed", { method: "POST" });

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });

  it("validates actions and maps retryable LLM failures to 503", async () => {
    const a = await app();
    expect((await a.request("/api/invoices/inv-1/actions", { method: "POST", body: JSON.stringify({ type: "nope" }) })).status).toBe(400);

    const ok = await a.request("/api/invoices/inv-1/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "submit" }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ submitted_by: "human" });

    const { LlmBusyError } = await import("../src/llm.js");
    mocks.applyAction.mockRejectedValueOnce(new LlmBusyError());
    const busy = await a.request("/api/invoices/inv-1/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "submit" }),
    });
    expect(busy.status).toBe(503);
  });
});
