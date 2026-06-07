import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Ad-hoc invoice generator. Pulls the live reference data (sponsors / studies /
 * sites / catalog), builds a fresh randomized-but-realistic invoice, and writes
 * a PDF + an .eml (the production email-intake shape) into fixtures/adhoc/ — so
 * you have genuinely new invoices to drop on the "Ingest invoice" button, not the
 * same four the demo seeds.
 *
 *   npm run make:invoice                 # 1 invoice, random scenario
 *   npm run make:invoice -- 5            # 5 invoices, each a random scenario
 *   npm run make:invoice -- 3 --scenario price   # force a scenario
 *
 * Scenarios shape what the AI should decide:
 *   clean      everything resolves & matches  → expect auto-submit
 *   price      a couple line items over catalog price → held: price mismatch
 *   unmatched  off-catalog line items added   → held: unmatched line items
 *   metadata   sponsor / protocol fuzzed wrong → held: unresolved / protocol
 */

const API = process.env.REFERENCE_API ?? "http://localhost:8000/api/v1";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "fixtures", "adhoc");

type Scenario = "clean" | "price" | "unmatched" | "metadata";
const SCENARIOS: Scenario[] = ["clean", "price", "unmatched", "metadata"];

interface Sponsor { id: number; name: string; code: string }
interface Study { id: number; sponsor_id: number; name: string; protocol_number: string }
interface Site { id: number; name: string; city?: string; state?: string; pi_name?: string }
interface StudySite { study_id: number; site_id: number }
interface Catalog { item_code: string; description: string; unit_price: string }
interface Line { description: string; quantity: number; unit_price: number }

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(xs: T[]): T => xs[rand(0, xs.length - 1)]!;
const sample = <T,>(xs: T[], k: number): T[] => [...xs].sort(() => Math.random() - 0.5).slice(0, k);
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function items<T>(path: string): Promise<T[]> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return ((await res.json()) as { items: T[] }).items;
}

// Off-catalog line items used by the "unmatched" scenario — plausible site costs
// that won't appear in any study catalog.
const OFF_CATALOG = [
  ["Courier / Overnight Shipping", 120],
  ["Parking Reimbursement", 25],
  ["Miscellaneous Site Supplies", 60],
  ["Translator Services", 150],
  ["Records Storage Fee", 85],
] as const;

async function buildOne(scenario: Scenario, ref: { sponsors: Sponsor[]; studies: Study[]; sites: Site[]; studySites: StudySite[] }) {
  const sponsor = pick(ref.sponsors);
  const study = pick(ref.studies.filter((s) => s.sponsor_id === sponsor.id));
  const catalog = await items<Catalog>(`/catalog-items?sponsor_id=${sponsor.id}&study_id=${study.id}`);
  const linkedIds = new Set(ref.studySites.filter((ss) => ss.study_id === study.id).map((ss) => ss.site_id));
  const linked = ref.sites.filter((s) => linkedIds.has(s.id));
  const site = pick(linked.length ? linked : ref.sites);

  const lines: Line[] = sample(catalog, Math.min(rand(4, 8), catalog.length)).map((c) => ({
    description: c.description,
    quantity: rand(1, 5),
    unit_price: Number(c.unit_price),
  }));

  // Per-scenario perturbation — everything else stays catalog-faithful so the AI
  // has exactly one reason (or none) to hold.
  let sponsorName = sponsor.name;
  let protocol = study.protocol_number;
  if (scenario === "price") for (const l of sample(lines, rand(1, 2))) l.unit_price += pick([25, 50, 75]);
  if (scenario === "unmatched") for (const [desc, price] of sample([...OFF_CATALOG], rand(1, 2))) lines.push({ description: desc, quantity: rand(1, 4), unit_price: price });
  if (scenario === "metadata") {
    sponsorName = `${sponsor.name} Inc.`; // close-but-not-exact sponsor string
    protocol = protocol.replace(/(\d{4})/, (y) => String(Number(y) + 1)); // wrong protocol year
  }

  const total = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const number = `INV-ADHOC-${new Date().toISOString().slice(5, 10).replace("-", "")}-${rand(100, 999)}`;
  const date = new Date().toISOString().slice(0, 10);
  return { scenario, number, date, sponsorName, protocol, study, site, lines, total };
}

type Invoice = Awaited<ReturnType<typeof buildOne>>;

async function renderPdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.05, 0.06);
  const muted = rgb(0.4, 0.42, 0.46);
  let y = 740;
  const text = (s: string, x: number, opts: { size?: number; f?: typeof font; color?: typeof ink } = {}) =>
    page.drawText(s, { x, y, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? ink });

  text("CLINICAL TRIAL SITE INVOICE", 56, { size: 11, f: bold, color: muted });
  y -= 28;
  text(`Invoice #: ${inv.number}`, 56, { f: bold });
  text(`Date: ${inv.date}`, 320, { f: bold });
  y -= 22;
  text(`From: ${inv.site.name}`, 56, { f: bold });
  y -= 15;
  text(`${[inv.site.city, inv.site.state].filter(Boolean).join(", ")} · PI: ${inv.site.pi_name ?? "—"}`, 56, { color: muted });
  y -= 26;
  text(`Study: ${inv.study.name}`, 56, { f: bold });
  y -= 15;
  text(`Protocol: ${inv.protocol}`, 56);
  y -= 15;
  text(`Sponsor: ${inv.sponsorName}`, 56);
  y -= 32;

  // Line-item table.
  const cols = { desc: 56, qty: 360, unit: 420, amt: 510 };
  text("Description", cols.desc, { size: 9, f: bold, color: muted });
  text("Qty", cols.qty, { size: 9, f: bold, color: muted });
  text("Unit Price", cols.unit, { size: 9, f: bold, color: muted });
  text("Amount", cols.amt, { size: 9, f: bold, color: muted });
  y -= 6;
  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 0.5, color: muted });
  y -= 16;
  for (const l of inv.lines) {
    text(l.description, cols.desc);
    text(String(l.quantity), cols.qty);
    text(money(l.unit_price), cols.unit);
    text(money(l.unit_price * l.quantity), cols.amt);
    y -= 16;
  }
  y -= 4;
  page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 0.5, color: muted });
  y -= 18;
  text("Total:", cols.unit, { f: bold });
  text(money(inv.total), cols.amt, { f: bold });
  return doc.save();
}

const chunk = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, "g")) ?? [];

function toEml(pdf: Uint8Array, inv: Invoice): string {
  const slug = inv.site.name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 18) || "site";
  const b64 = chunk(Buffer.from(pdf).toString("base64"), 76).join("\r\n");
  const boundary = "----ledgerrun-invoice-boundary";
  return [
    `From: billing@${slug}.org`,
    `To: invoices@ledgerrun.com`,
    `Subject: Invoice ${inv.number} — ${inv.study.name}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Please find our site invoice attached for processing.`,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf; name="${inv.number}.pdf"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${inv.number}.pdf"`,
    ``,
    b64,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

const EXPECT: Record<Scenario, string> = {
  clean: "auto-submit",
  price: "held · price mismatch",
  unmatched: "held · unmatched line items",
  metadata: "held · unresolved / protocol",
};

async function main() {
  const argv = process.argv.slice(2);
  const count = Number(argv.find((a) => /^\d+$/.test(a)) ?? 1);
  const flag = argv[argv.indexOf("--scenario") + 1];
  const forced = SCENARIOS.includes(flag as Scenario) ? (flag as Scenario) : null;

  let ref;
  try {
    const [sponsors, studies, sites, studySites] = await Promise.all([
      items<Sponsor>("/sponsors"),
      items<Study>("/studies"),
      items<Site>("/sites"),
      items<StudySite>("/study-sites"),
    ]);
    ref = { sponsors, studies, sites, studySites };
  } catch (e) {
    console.error(`\n✗ Could not reach the reference API at ${API}.\n  Start it with:  docker compose up -d\n  (${e instanceof Error ? e.message : e})\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  console.log(`\nGenerating ${count} invoice${count > 1 ? "s" : ""} → fixtures/adhoc/\n`);
  for (let i = 0; i < count; i++) {
    const inv = await buildOne(forced ?? pick(SCENARIOS), ref);
    const pdf = await renderPdf(inv);
    writeFileSync(join(outDir, `${inv.number}.pdf`), pdf);
    writeFileSync(join(outDir, `${inv.number}.eml`), toEml(pdf, inv));
    console.log(
      `  ${inv.number}  ${money(inv.total).padStart(11)}  ${inv.lines.length} items  ` +
        `${inv.sponsorName} / ${inv.study.name}\n` +
        `    scenario: ${inv.scenario}  →  expect ${EXPECT[inv.scenario]}`,
    );
  }
  console.log(`\nDrop any .eml or .pdf from fixtures/adhoc/ onto the "Ingest invoice" button (needs ANTHROPIC_API_KEY set).\n`);
}

main();
