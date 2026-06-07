import { useEffect, useState } from "react";
import { InvoiceRecord, InvoiceList } from "@ledgerrun/contract";
import { api } from "./api";

// Live invoice feed over SSE: one snapshot, then a merge per state change as the
// pipeline advances — so the lanes and the theater move in real time instead of
// on a poll tick. Falls back to polling if the stream can't open.
export function useInvoices(): InvoiceRecord[] {
  const [byId, setById] = useState<Map<string, InvoiceRecord>>(new Map());

  useEffect(() => {
    const apply = (recs: InvoiceRecord[]) =>
      setById((prev) => {
        const next = new Map(prev);
        for (const r of recs) next.set(r.id, r);
        return next;
      });

    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (poll) return;
      const tick = () => api.list().then(apply).catch(() => {});
      tick();
      poll = setInterval(tick, 2000);
    };

    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/stream");
      es.addEventListener("snapshot", (e) =>
        apply(InvoiceList.parse(JSON.parse((e as MessageEvent).data))),
      );
      es.addEventListener("invoice", (e) =>
        apply([InvoiceRecord.parse(JSON.parse((e as MessageEvent).data))]),
      );
      es.onerror = () => {
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, []);

  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
