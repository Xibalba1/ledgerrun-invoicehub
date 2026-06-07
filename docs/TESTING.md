# Testing and Evaluation Discipline

LedgerRun uses a layered test gate. Fast deterministic checks run on every PR; live LLM evaluation stays explicit because it uses networked model calls and spend.

## PR Gate

Run on every pull request:

- `npm run typecheck`
- `npm run test:coverage`
- `npm run build:web`
- `npm run test:e2e`
- `npm run test:reference`

The GitHub Actions workflow in `.github/workflows/ci.yml` enforces these layers separately so browser/reference failures are easy to identify.

## Deterministic Tests

- Vitest unit and integration tests cover matching, metadata resolution, decisioning, ingest, HTTP API behavior, pipeline state transitions, web API parsing, SSE/polling behavior, and web utility logic.
- `fixtures/deterministic-golden.json` is the deeper deterministic eval set. It contains 25 golden cases over clean submits, price mismatches, unmatched lines, low-confidence matches, unresolved metadata, protocol mismatches, total warnings, scoped-catalog failures, and LLM decision reconciliation.
- `npm run eval:offline` runs the recorded-output smoke eval plus the 25-case deterministic golden set.

## Coverage

`npm run test:coverage` measures the deterministic/unit-testable surface:

- server core modules, excluding live LLM and MCP process wrappers
- shared Zod contract module
- web API, hook, and utility modules

Large React surfaces are exercised by Playwright E2E instead of line coverage.

## Browser E2E

`npm run test:e2e` runs the Vite app under Playwright with mocked `/api/*` responses. It verifies the actual UI workflow for:

- empty inbox onboarding
- demo seeding
- held invoice review
- manual submit
- escalation reason capture

The suite runs against desktop Chromium and a mobile viewport.

## Reference API

`npm run test:reference` runs pytest against the vendored FastAPI reference API using a temporary SQLite database seeded from `reference-api/api/seed/data/*.json`.

## Live LLM Eval

`npm run eval` is the release/readiness check for real model behavior. It drives the full pipeline over `.eml` fixtures using live extraction, entity resolution, line-item matching, decisioning, and the MCP/reference boundary.

Run it before release candidates, model changes, prompt changes, catalog changes, or any change to extraction/resolution/matching/decisioning behavior. Do not put it in the fast PR gate unless CI has explicit model credentials, budget controls, and flake triage ownership.
