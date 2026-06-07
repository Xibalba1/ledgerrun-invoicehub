import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { ActionRequest, type InvoiceRecord } from "@ledgerrun/contract";
import { ingest } from "./ingest.js";
import { newInvoice, runPipeline, applyAction } from "./pipeline.js";
import { LlmBusyError } from "./llm.js";
import { seedDemo } from "./replay.js";
import { savePdf, loadPdf, clearPdfs } from "./storage.js";
import { getInvoice, listInvoices, clearInvoices } from "./db.js";
import { subscribe } from "./events.js";
import { fetchReferenceSnapshot, fetchCatalog } from "./mcp/client.js";
import { llmConfigured } from "./llm.js";
import { log } from "./logger.js";

export const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true, llm: llmConfigured() }));

// Live feed of the AI-first run: a snapshot on connect, then every state change
// as the pipeline advances. Replaces hub polling — the source of the live theater.
app.get("/api/stream", (c) =>
  streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "snapshot", data: JSON.stringify(listInvoices()) });
    const queue: InvoiceRecord[] = [];
    let wake: (() => void) | null = null;
    const unsub = subscribe((rec) => {
      queue.push(rec);
      wake?.();
    });
    stream.onAbort(unsub);
    try {
      while (!stream.aborted) {
        if (queue.length) {
          await stream.writeSSE({ event: "invoice", data: JSON.stringify(queue.shift()) });
          continue;
        }
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
    } finally {
      unsub();
    }
  }),
);

// Reference lists for the QC correction dropdowns (fetched through the MCP boundary).
app.get("/api/reference", async (c) => c.json(await fetchReferenceSnapshot()));

// Scoped catalog for the QC line-item reassignment dropdown.
app.get("/api/catalog", async (c) => {
  const sponsor = Number(c.req.query("sponsor_id"));
  const study = Number(c.req.query("study_id"));
  if (!sponsor || !study) return c.json({ error: "sponsor_id and study_id required" }, 400);
  return c.json(await fetchCatalog(sponsor, study));
});

app.get("/api/invoices", (c) => c.json(listInvoices()));

app.get("/api/invoices/:id", (c) => {
  const rec = getInvoice(c.req.param("id"));
  return rec ? c.json(rec) : c.json({ error: "not found" }, 404);
});

// The source PDF the AI actually read — shown beside the extraction so reviewers
// can verify what was pulled out, not just trust it.
app.get("/api/invoices/:id/source", (c) => {
  const id = c.req.param("id");
  if (!getInvoice(id)) return c.json({ error: "not found" }, 404);
  try {
    const pdf = loadPdf(id);
    return c.body(new Uint8Array(pdf).buffer, 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${id}.pdf"`,
    });
  } catch {
    return c.json({ error: "no source on file" }, 404);
  }
});

// Upload an .eml (PDF attachment) or a raw PDF; kick off the pipeline and return
// the record immediately. The hub polls GET /api/invoices/:id for progress.
app.post("/api/invoices", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "expected a 'file' upload" }, 400);
  if (!llmConfigured()) return c.json({ error: "ANTHROPIC_API_KEY is not set" }, 503);

  const buffer = Buffer.from(await file.arrayBuffer());
  let ingested;
  try {
    ingested = await ingest(buffer, file.name);
  } catch (err) {
    return c.json({ error: String(err) }, 400);
  }

  const rec = newInvoice(ingested.source);
  savePdf(rec.id, ingested.pdf);
  log.info("invoice.received", { id: rec.id, filename: file.name, kind: ingested.source.kind });
  void runPipeline(rec.id, ingested.pdf);
  return c.json(rec, 202);
});

// One-click demo: stream the four sample invoices through the pipeline using
// recorded LLM outputs with realistic per-stage pacing — the theater plays
// identically with or without an API key. Progress arrives over /api/stream.
app.post("/api/demo/seed", async (c) => {
  const ids = await seedDemo();
  return c.json({ ids }, 202);
});

// Wipe every invoice and its stored PDF — back to a clean inbox. Lets the demo be
// re-run from zero without restarting the server.
app.post("/api/demo/reset", (c) => {
  clearInvoices();
  clearPdfs();
  log.info("demo.reset");
  return c.json({ ok: true });
});

app.post("/api/invoices/:id/actions", async (c) => {
  const parsed = ActionRequest.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    return c.json(await applyAction(c.req.param("id"), parsed.data));
  } catch (err) {
    // The model was overloaded; the correction itself was already persisted, so
    // 503 (retryable) with a human message — not a raw 400 dump.
    if (err instanceof LlmBusyError) return c.json({ error: err.message }, 503);
    return c.json({ error: String(err) }, 400);
  }
});
