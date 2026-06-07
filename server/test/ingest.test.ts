import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest.js";

const pdf = Buffer.from("%PDF-1.4\nsample\n%%EOF");

function emlWithAttachment(filename = "invoice.pdf", contentType = "application/pdf") {
  return Buffer.from(`From: Site Billing <billing@example.test>
To: ap@example.test
Subject: Invoice attached
Date: Mon, 01 Jun 2026 12:00:00 +0000
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/plain

Please see attached.

--b
Content-Type: ${contentType}
Content-Disposition: attachment; filename="${filename}"
Content-Transfer-Encoding: base64

${pdf.toString("base64")}
--b--
`);
}

describe("ingest", () => {
  it("accepts a raw PDF with null email provenance", async () => {
    const ingested = await ingest(pdf, "invoice.pdf");

    expect(ingested.pdf).toEqual(pdf);
    expect(ingested.source).toEqual({
      kind: "pdf",
      filename: "invoice.pdf",
      email: null,
    });
  });

  it("extracts a PDF attachment and email provenance from .eml input", async () => {
    const ingested = await ingest(emlWithAttachment(), "mail.eml");

    expect(ingested.pdf.toString()).toBe(pdf.toString());
    expect(ingested.source.kind).toBe("eml");
    expect(ingested.source.email).toMatchObject({
      from: '"Site Billing" <billing@example.test>',
      subject: "Invoice attached",
      date: "2026-06-01T12:00:00.000Z",
    });
  });

  it("accepts attachments identified by .pdf filename when content type is generic", async () => {
    const ingested = await ingest(emlWithAttachment("invoice.PDF", "application/octet-stream"), "mail.eml");

    expect(ingested.pdf.toString()).toBe(pdf.toString());
  });

  it("throws a clear boundary error when an email has no PDF attachment", async () => {
    await expect(ingest(Buffer.from("Subject: no attachment\n\nNo PDF here."), "mail.eml")).rejects.toThrow(
      'No PDF attachment found in email "mail.eml".',
    );
  });
});
