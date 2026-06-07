import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ingest } from "../server/src/ingest.js";
import { extractInvoice, proposeMatches, resolveEntities, llmConfigured } from "../server/src/llm.js";
import { fetchReferenceSnapshot, fetchCatalog } from "../server/src/mcp/client.js";
import { resolveContextFromProposal } from "../server/src/resolve.js";
import { buildMatches } from "../server/src/match.js";
import { decide } from "../server/src/decide.js";

// On-demand LIVE eval: drive the real pipeline (real LLM extraction + entity
// resolution + matching, real reference API via MCP) over the sample .eml fixtures and grade against
// fixtures/golden.json. This is the joint-system oracle — never wired to the
// Stop hook (it's networked + costs tokens). Run with: npm run eval.
const root = fileURLToPath(new URL("..", import.meta.url));
const golden = JSON.parse(readFileSync(join(root, "fixtures/golden.json"), "utf8"));
const emlDir = join(root, "fixtures/emls");

if (!llmConfigured()) {
  console.error("ANTHROPIC_API_KEY is not set — the live eval needs it. Copy .env.example to .env and add a key.");
  process.exit(1);
}

const eq = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
let failures = 0;

const snapshot = await fetchReferenceSnapshot();

for (const file of readdirSync(emlDir).filter((f) => f.endsWith(".eml")).sort()) {
  const name = file.replace(/\.eml$/, "");
  const g = golden[name];
  if (!g) continue;
  try {
    const { pdf } = await ingest(readFileSync(join(emlDir, file)), file);
    const extracted = await extractInvoice(pdf);
    const entityProposal = await resolveEntities(extracted, snapshot);
    const resolved = resolveContextFromProposal(extracted, snapshot, entityProposal);
    let matches = [] as ReturnType<typeof buildMatches>;
    if (resolved.sponsor.match && resolved.study.match) {
      const catalog = await fetchCatalog(resolved.sponsor.match.id, resolved.study.match.id);
      matches = buildMatches(extracted.line_items, await proposeMatches(extracted.line_items, catalog), catalog);
    }
    const decision = decide(extracted, resolved, matches);
    const codes: string[] = decision.exceptions.map((e) => e.code);

    const checks = [
      ["sponsor", eq(resolved.sponsor.match?.id, g.sponsor_id)],
      ["study", eq(resolved.study.match?.id, g.study_id)],
      ["site", eq(resolved.site.match?.id, g.site_id)],
      ["decision", decision.decision === g.decision],
      ["exceptions", (g.exceptions as string[]).every((c) => codes.includes(c))],
    ] as const;
    const failed = checks.filter(([, ok]) => !ok).map(([k]) => k);

    if (failed.length) {
      failures++;
      console.log(`✗ ${name} — failed: ${failed.join(", ")}`);
      console.log(`    got: sponsor=${resolved.sponsor.match?.id ?? null} study=${resolved.study.match?.id ?? null} site=${resolved.site.match?.id ?? null} decision=${decision.decision} exceptions=[${codes.join(", ")}]`);
    } else {
      console.log(`✓ ${name} — ${decision.decision} (${matches.length} items, exceptions: [${codes.join(", ") || "none"}])`);
    }
  } catch (err) {
    failures++;
    console.log(`✗ ${name} — pipeline error: ${err}`);
  }
}

console.log(failures ? `\n${failures} sample(s) failed.` : "\nAll samples matched the golden expectations.");
process.exit(failures ? 1 : 0);
