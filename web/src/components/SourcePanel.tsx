import type { InvoiceRecord } from "@ledgerrun/contract";
import { sourceUrl } from "../lib";

// The document the AI actually read, beside its extraction — so a reviewer
// verifies rather than trusts. The PDF renders in-browser; .eml provenance
// (from / subject) sits above it.
export default function SourcePanel({ invoice }: { invoice: InvoiceRecord }) {
  const email = invoice.source.email;
  return (
    <div className="flex h-full min-h-[60vh] flex-col overflow-hidden rounded-card border border-line bg-card shadow-card">
      <div className="border-b border-line px-4 py-2.5">
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-2">Source document</div>
        {email ? (
          <div className="mt-1.5 space-y-0.5 text-[13px]">
            <div className="truncate text-ink-2">
              <span className="text-muted-2">From </span>
              {email.from}
            </div>
            <div className="truncate text-ink">
              <span className="text-muted-2">Subject </span>
              {email.subject}
            </div>
          </div>
        ) : (
          <div className="mt-1 truncate font-mono text-[12.5px] text-muted">{invoice.source.filename}</div>
        )}
      </div>
      <iframe title="Source document" src={sourceUrl(invoice)} className="w-full flex-1 bg-surface" />
    </div>
  );
}
