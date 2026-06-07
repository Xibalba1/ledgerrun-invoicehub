---
status: active
owner: engineering
last_reviewed: 2026-06-07
superseded_by:
---

# Architecture

LedgerRun is a local-first, AI-assisted invoice ingestion hub for clinical-trial finance operations. Its architecture is intentionally staged: untrusted documents and model output are converted into typed records, enriched with reference data, reconciled against deterministic safety checks, and then exposed to reviewers with enough evidence to correct or override the result. The core design principle is that AI performs the first pass end to end, while TypeScript validation and deterministic guardrails make the outcome auditable.

## Components

1. **Workspace packages (`shared`, `server`, `web`)**  
   The repo is a TypeScript npm workspace so the browser, API, pipeline, and scripts share one contract without publishing artifacts. This keeps the project small, local-first, and free of duplicated domain types.

2. **Shared contract (`shared/src/index.ts`)**  
   Zod schemas define reference entities, extracted invoices, model proposals, matches, decisions, records, and QC actions. This is the trust boundary: LLM responses, MCP responses, persisted JSON, and browser API responses are parsed before use. Runtime validation is justified because the highest-value inputs are external or model-generated.

3. **Reference stack (`reference-api/`, `docker-compose.yml`)**  
   The provided FastAPI/Postgres service is vendored and run with Docker Compose. It remains read-only and separate because sponsor, study, site, and catalog data are an external source of truth, not app-owned state.

4. **MCP wrapper (`server/src/mcp/server.ts`, `server/src/mcp/client.ts`)**  
   The server wraps the reference API as MCP tools and consumes them through a long-lived stdio client. This satisfies the PRD requirement and gives reference data one narrow, validated entry point. Pagination and sponsor-study catalog scoping live here.

5. **HTTP API and event stream (`server/src/api.ts`, `server/src/events.ts`)**  
   A Hono server exposes upload, invoice read, source PDF, reference, catalog, demo, reset, and QC action endpoints. `/api/stream` publishes Server-Sent Events so the UI follows stage changes live. This layer stays thin: accept files and actions, start or update pipeline work, return contract-shaped records.

6. **Ingestion and source storage (`server/src/ingest.ts`, `server/src/storage.ts`)**  
   Intake accepts production-shaped `.eml` files with PDF attachments, plus raw PDFs for demo convenience. Ingestion normalizes both to a PDF plus provenance, and storage keeps the PDF for reviewer inspection and reruns. Downstream stages can assume one document format.

7. **AI pipeline (`server/src/pipeline.ts`, `server/src/llm.ts`)**  
   The pipeline persists after each stage: received, extracting, resolving, matching, deciding, done, or failed. Anthropic calls handle PDF extraction, entity-resolution proposals, semantic catalog-match proposals, and submit-versus-hold decision proposals. Each response is checked for refusal or truncation, parsed as JSON, and validated before it affects state.

8. **Deterministic validation, matching, and decision reconciliation (`server/src/resolve.ts`, `server/src/match.ts`, `server/src/decide.ts`)**
   Deterministic code validates model-selected IDs, enforces sponsor-study scope, checks protocol equality, calculates price deltas, applies confidence thresholds, and builds the canonical exception list. The LLM proposes submit versus hold from those validated signals, then deterministic reconciliation keeps block exceptions authoritative, allows model-recommended holds, and preserves warnings for reviewers.

9. **Persistence (`server/src/db.ts`)**  
   SQLite stores each validated invoice record as JSON via `better-sqlite3` with WAL mode. SQLite fits the local-first, state-light demo, while whole-record storage keeps timings, extracted data, matches, decisions, and audit trail together.

10. **Review hub (`web/src/`)**  
    The React/Vite UI is a post-decision operations surface. It groups invoices into lanes, shows live progress, displays extraction/matching/confidence/exceptions/source PDFs, and lets reviewers correct metadata or matches, rerun, escalate, note, or manually submit. Browser responses are validated with the shared contract.

11. **Demo, fixtures, and verification (`fixtures/`, `sample-invoices/`, `eval/`, `server/test/`, `verify.ts`)**  
    Recorded fixtures let the demo and offline tests exercise the deterministic chain without an API key or model spend. The live eval runs the real LLM and MCP-backed pipeline against golden expectations. This split keeps daily verification fast while preserving an integration check for AI behavior.

## End-to-End Flow

An invoice enters through upload or demo seed, is normalized to a PDF, and receives an `InvoiceRecord`. The pipeline extracts metadata and line items, fetches reference data through MCP, validates context, fetches a scoped catalog, validates match proposals, asks the LLM for a submit-or-hold decision proposal, and reconciles that proposal with deterministic blockers. Each transition is persisted and published over SSE. Reviewers inspect the result in the hub; QC actions update the same record, rerun affected matching and LLM-assisted decisioning, and leave an audit trail.
