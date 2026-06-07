import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "@ledgerrun/contract";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  ingest: vi.fn(),
  newInvoice: vi.fn(),
  savePdf: vi.fn(),
  getInvoice: vi.fn(),
  saveInvoice: vi.fn(),
  fetchReferenceSnapshot: vi.fn(),
  fetchCatalog: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));
vi.mock("../src/ingest.js", () => ({ ingest: mocks.ingest }));
vi.mock("../src/pipeline.js", () => ({ newInvoice: mocks.newInvoice }));
vi.mock("../src/storage.js", () => ({ savePdf: mocks.savePdf }));
vi.mock("../src/db.js", () => ({
  getInvoice: mocks.getInvoice,
  saveInvoice: mocks.saveInvoice,
}));
vi.mock("../src/mcp/client.js", () => ({
  fetchReferenceSnapshot: mocks.fetchReferenceSnapshot,
  fetchCatalog: mocks.fetchCatalog,
}));
vi.mock("../src/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const invoice = (id: string): InvoiceRecord => ({
  id,
  created_at: "2026-06-07T00:00:00.000Z",
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
});

describe("demo replay seeding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
    mocks.readFileSync.mockImplementation((path: string) => {
      if (path.endsWith("recorded.json")) {
        return JSON.stringify({
          "simple-invoice": {},
          "medium-invoice": {},
          "large-invoice": {},
          "mismatched-metadata-invoice": {},
        });
      }
      return Buffer.from(`%PDF ${path}`);
    });
    mocks.ingest.mockImplementation((bytes: Buffer, filename: string) =>
      Promise.resolve({ pdf: bytes, source: { kind: "pdf", filename, email: null } }),
    );
    mocks.newInvoice.mockImplementation((source: InvoiceRecord["source"]) => invoice(source.filename));
  });

  it("falls back to tracked sample PDFs when generated EML fixtures are absent", async () => {
    const { seedDemo } = await import("../src/replay.js");

    const ids = await seedDemo();

    expect(ids).toEqual([
      "simple-invoice.pdf",
      "medium-invoice.pdf",
      "large-invoice.pdf",
      "mismatched-metadata-invoice.pdf",
    ]);
    expect(mocks.ingest).toHaveBeenCalledWith(expect.any(Buffer), "simple-invoice.pdf");
    expect(mocks.ingest).toHaveBeenCalledWith(expect.any(Buffer), "mismatched-metadata-invoice.pdf");
    expect(mocks.savePdf).toHaveBeenCalledTimes(4);
  });
});
