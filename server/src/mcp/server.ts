import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "../config.js";

/**
 * MCP-wrapped reference API (PRD FR3). A thin stdio server that fans the
 * read-only Clinical Trials Reference API out as MCP tools, paginating fully so
 * callers get whole lists (the LUMIN catalog is ~100 items). The pipeline's
 * context-resolution and catalog-fetch stages talk to this, never to HTTP
 * directly — the reference data enters the system through one wrapped boundary.
 *
 * stdout carries the MCP protocol only; diagnostics go to stderr.
 */
const base = config.referenceApiUrl;

async function fetchAll(path: string, query: Record<string, number | undefined> = {}): Promise<unknown[]> {
  const out: unknown[] = [];
  let page = 1;
  let pages = 1;
  do {
    const params = new URLSearchParams({ page: String(page), page_size: "100" });
    for (const [k, v] of Object.entries(query)) if (v != null) params.set(k, String(v));
    const res = await fetch(`${base}${path}?${params}`);
    if (!res.ok) throw new Error(`reference API ${path} → ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { items: unknown[]; pages: number };
    out.push(...body.items);
    pages = body.pages;
    page++;
  } while (page <= pages);
  return out;
}

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

const server = new McpServer({ name: "ctref-mcp", version: "1.0.0" });

server.tool("list_sponsors", "List all clinical-trial sponsors.", {}, async () =>
  json(await fetchAll("/api/v1/sponsors")),
);
server.tool(
  "list_studies",
  "List studies, optionally scoped to one sponsor.",
  { sponsor_id: z.number().int().optional() },
  async ({ sponsor_id }) => json(await fetchAll("/api/v1/studies", { sponsor_id })),
);
server.tool("list_sites", "List all research sites.", {}, async () => json(await fetchAll("/api/v1/sites")));
server.tool(
  "get_catalog_items",
  "Fetch the billable line-item catalog scoped to a sponsor + study.",
  { sponsor_id: z.number().int(), study_id: z.number().int() },
  async ({ sponsor_id, study_id }) => json(await fetchAll("/api/v1/catalog-items", { sponsor_id, study_id })),
);

async function main() {
  await server.connect(new StdioServerTransport());
  process.stderr.write(`ctref-mcp connected → ${base}\n`);
}

main().catch((err) => {
  process.stderr.write(`ctref-mcp failed: ${err}\n`);
  process.exit(1);
});
