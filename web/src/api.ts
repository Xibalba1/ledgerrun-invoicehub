import { InvoiceRecord, InvoiceList, ReferenceSnapshot, CatalogItem, type ActionRequest } from "@ledgerrun/contract";
import { z } from "zod";

// Typed client: every response is validated against the boundary contract before
// it reaches the UI — the same parse-or-throw discipline the server applies inward.
async function getJson<T>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const res = await fetch(url);
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `${url} failed (${res.status})`));
  return schema.parse(body);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) return { error: `${res.url || "request"} failed (${res.status})` };
    throw new Error("Response was not valid JSON.");
  }
}

function errorMessage(body: unknown, fallback: string): string {
  return typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export const api = {
  health: () => fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; llm: boolean }>),
  list: () => getJson("/api/invoices", InvoiceList),
  get: (id: string) => getJson(`/api/invoices/${id}`, InvoiceRecord),
  reference: () => getJson("/api/reference", ReferenceSnapshot),
  catalog: (sponsorId: number, studyId: number) =>
    getJson(`/api/catalog?sponsor_id=${sponsorId}&study_id=${studyId}`, CatalogItem.array()),
  async demoSeed(): Promise<{ ids: string[] }> {
    const res = await fetch("/api/demo/seed", { method: "POST" });
    const body = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(body, `demo seed failed (${res.status})`));
    return z.object({ ids: z.string().array() }).parse(body);
  },
  async reset(): Promise<{ ok: boolean }> {
    const res = await fetch("/api/demo/reset", { method: "POST" });
    const body = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(body, `reset failed (${res.status})`));
    return z.object({ ok: z.boolean() }).parse(body);
  },
  async upload(file: File): Promise<InvoiceRecord> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/invoices", { method: "POST", body: form });
    const body = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(body, `upload failed (${res.status})`));
    return InvoiceRecord.parse(body);
  },
  async action(id: string, action: ActionRequest): Promise<InvoiceRecord> {
    const res = await fetch(`/api/invoices/${id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const body = await readJson(res);
    if (!res.ok) throw new Error(errorMessage(body, `action failed (${res.status})`));
    return InvoiceRecord.parse(body);
  },
};
