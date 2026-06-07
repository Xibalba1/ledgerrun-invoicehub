import "dotenv/config";

export const config = {
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
  // Transient 429/5xx (incl. 529 overloaded) are retried by the SDK with backoff
  // before surfacing; a few extra attempts absorb most capacity blips.
  anthropicMaxRetries: Number(process.env.ANTHROPIC_MAX_RETRIES ?? 4),
  referenceApiUrl: process.env.REFERENCE_API_URL ?? "http://localhost:8000",
  port: Number(process.env.PORT ?? 8791),
  dbPath: process.env.DB_PATH ?? "./data/ledgerrun.db",
};
