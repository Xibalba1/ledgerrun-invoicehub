import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Wrap each sample invoice PDF in a minimal RFC-822 .eml (multipart/mixed with a
// base64 PDF attachment), so the production email-intake path is demonstrable
// end to end. No mail library needed — this is plain MIME assembly.
const root = fileURLToPath(new URL("..", import.meta.url));
const pdfDir = join(root, "sample-invoices");
const outDir = join(root, "fixtures", "emls");
mkdirSync(outDir, { recursive: true });

const senders: Record<string, { from: string; subject: string; date: string }> = {
  "simple-invoice.pdf": { from: "billing@willowcreekcrc.org", subject: "Invoice INV-2024-001 — CATALYST Trial", date: "Fri, 15 Mar 2024 09:12:00 -0700" },
  "medium-invoice.pdf": { from: "ap@harborviewmedical.org", subject: "Site Invoice INV-2024-042 (LUMIN-2024)", date: "Thu, 20 Jun 2024 14:03:00 -0500" },
  "large-invoice.pdf": { from: "finance@highlandridge.org", subject: "Invoice INV-2024-108 — LUMIN-2024 Q3", date: "Thu, 12 Sep 2024 11:47:00 -0600" },
  "mismatched-metadata-invoice.pdf": { from: "accounts@prairieclinical.com", subject: "Clinical Trial Invoice INV-2024-077", date: "Tue, 30 Jul 2024 16:21:00 -0500" },
};

const chunk = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, "g")) ?? [];

for (const file of readdirSync(pdfDir).filter((f) => f.endsWith(".pdf"))) {
  const meta = senders[file] ?? { from: "site@example.org", subject: `Invoice ${file}`, date: "Mon, 01 Jan 2024 00:00:00 +0000" };
  const b64 = chunk(readFileSync(join(pdfDir, file)).toString("base64"), 76).join("\r\n");
  const boundary = "----ledgerrun-invoice-boundary";
  const eml = [
    `From: ${meta.from}`,
    `To: invoices@ledgerrun.com`,
    `Subject: ${meta.subject}`,
    `Date: ${meta.date}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Please find our site invoice attached for processing.`,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${file}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${file}"`,
    ``,
    b64,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
  const out = join(outDir, file.replace(/\.pdf$/, ".eml"));
  writeFileSync(out, eml);
  console.log(`wrote ${out}`);
}
