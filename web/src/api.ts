import { InvoiceRecord, InvoiceList, ReferenceSnapshot, CatalogItem, type ActionRequest } from "@ledgerrun/contract";
import { z } from "zod";

// Typed client: every response is validated against the boundary contract before
// it reaches the UI — the same parse-or-throw discipline the server applies inward.
async function getJson<T>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return schema.parse(await res.json());
}

export const api = {
  health: () => fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; llm: boolean }>),
  list: () => getJson("/api/invoices", InvoiceList),
  get: (id: string) => getJson(`/api/invoices/${id}`, InvoiceRecord),
  reference: () => getJson("/api/reference", ReferenceSnapshot),
  catalog: (sponsorId: number, studyId: number) =>
    getJson(`/api/catalog?sponsor_id=${sponsorId}&study_id=${studyId}`, CatalogItem.array()),
  demoSeed: () => fetch("/api/demo/seed", { method: "POST" }).then((r) => r.json() as Promise<{ ids: string[] }>),
  reset: () => fetch("/api/demo/reset", { method: "POST" }).then((r) => r.json() as Promise<{ ok: boolean }>),
  async upload(file: File): Promise<InvoiceRecord> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/invoices", { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`);
    return InvoiceRecord.parse(body);
  },
  async action(id: string, action: ActionRequest): Promise<InvoiceRecord> {
    const res = await fetch(`/api/invoices/${id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `action failed (${res.status})`);
    return InvoiceRecord.parse(body);
  },
};
