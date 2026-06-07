import { simpleParser } from "mailparser";
import type { InvoiceRecord } from "@ledgerrun/contract";

export interface Ingested {
  pdf: Buffer;
  source: InvoiceRecord["source"];
}

/**
 * Production intake is `.eml` email with a PDF attachment; we also accept a raw
 * PDF for convenience. Either way we end at one PDF buffer + provenance. Throws
 * with a clear message if an email carries no PDF — a boundary the rest of the
 * pipeline can assume is satisfied.
 */
export async function ingest(buffer: Buffer, filename: string): Promise<Ingested> {
  const isEml = filename.toLowerCase().endsWith(".eml");
  if (!isEml) {
    return { pdf: buffer, source: { kind: "pdf", filename, email: null } };
  }

  const mail = await simpleParser(buffer);
  const pdf = mail.attachments.find(
    (a) => a.contentType === "application/pdf" || (a.filename ?? "").toLowerCase().endsWith(".pdf"),
  );
  if (!pdf) throw new Error(`No PDF attachment found in email "${filename}".`);

  return {
    pdf: pdf.content,
    source: {
      kind: "eml",
      filename,
      email: {
        from: mail.from?.text ?? "unknown",
        subject: mail.subject ?? "(no subject)",
        date: mail.date?.toISOString() ?? new Date(0).toISOString(),
      },
    },
  };
}
