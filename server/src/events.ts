import type { InvoiceRecord } from "@ledgerrun/contract";

// In-process fan-out of invoice state changes. Every pipeline stage transition
// flows through saveInvoice, so publishing there gives the hub a live feed of the
// whole AI-first run — the SSE stream that drives the pipeline theater and the
// triage lanes without polling.
type Subscriber = (rec: InvoiceRecord) => void;
const subscribers = new Set<Subscriber>();

export function publish(rec: InvoiceRecord): void {
  for (const fn of subscribers) fn(rec);
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
}
