import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { CatalogItem, ReferenceSnapshot, Sponsor, Study, Site } from "@ledgerrun/contract";
import { z } from "zod";

// One long-lived MCP client connected to the wrapped reference API (server.ts),
// spawned as a stdio subprocess. Reference data only enters via these calls.
const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));

let clientPromise: Promise<Client> | null = null;

function connect(): Promise<Client> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", serverPath],
      env: process.env as Record<string, string>,
    });
    const client = new Client({ name: "ledgerrun-pipeline", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
  })();
  return clientPromise;
}

async function call<T>(name: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const client = await connect();
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text?: string }[];
  const text = content.find((c) => c.type === "text")?.text ?? "null";
  if (res.isError) throw new Error(`MCP tool ${name} failed: ${text}`);
  return schema.parse(JSON.parse(text)); // validate the wrapped boundary
}

/** Pull the small reference lists needed for metadata resolution in one shot. */
export async function fetchReferenceSnapshot(): Promise<ReferenceSnapshot> {
  const [sponsors, studies, sites] = await Promise.all([
    call("list_sponsors", {}, Sponsor.array()),
    call("list_studies", {}, Study.array()),
    call("list_sites", {}, Site.array()),
  ]);
  return ReferenceSnapshot.parse({ sponsors, studies, sites });
}

export async function fetchCatalog(sponsorId: number, studyId: number): Promise<CatalogItem[]> {
  return call("get_catalog_items", { sponsor_id: sponsorId, study_id: studyId }, CatalogItem.array());
}
