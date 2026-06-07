---
status: active
owner: engineering
last_reviewed: 2026-06-07
superseded_by:
source: PRD.md
---

# PRD Checklist

Source reviewed: `PRD.md`

Audit evidence: code review, `npm run verify`, `npm run build:web`, live `npm run eval`, local `/api/health`, local `/api/reference`, and local `/api/invoices`.

## Product Goal

- [x] Automate clinical trial site invoice intake, context resolution, catalog matching, and submit/hold decisioning.
- [ ] Reduce manual triage and repeated corrective work caused by misidentified context or mismatched line items. Completion not proven: no operational baseline or measured reduction is present.
- [x] Preserve operational control through transparent post-decision review surfaces.
- [x] Optimize for time saved as the primary impact metric. The hub now surfaces processed count, auto-clear rate, and estimated time saved using a documented minutes-per-auto-clear assumption.

## Intake Scope

- [x] Ingest invoice emails from `.eml` messages.
- [x] Extract and process PDF invoice attachments from inbound email messages.
- [x] Process the provided sample invoices end to end.
- [x] Treat non-PDF attachment formats as out of scope for the first production path unless later requirements add them.
- [x] Treat image-only invoices as out of scope for the first production path unless later requirements add them.

## AI-First Workflow

- [x] Complete extraction, matching, and decisioning before requiring human review.
- [x] Interpret invoices with inconsistent formatting, terminology, and structure.
- [x] Extract invoice metadata using an LLM.
- [x] Extract invoice line items using an LLM.
- [x] Use LLM integration for metadata and entity resolution. Entity resolution now asks the LLM to choose sponsor/study/site IDs from MCP-fetched candidates, then deterministically validates confidence, ID existence, sponsor-study scope, and protocol match before decisioning.
- [x] Use LLM integration for line-item matching support.
- [ ] Use LLM integration for submit-versus-hold decisioning. Not implemented as written: submit-versus-hold policy is deterministic over AI-derived extraction and matching signals.
- [x] Communicate why the AI submitted or held each invoice.

## Reference API and Context Resolution

- [x] Resolve sponsor context through the MCP-wrapped reference API.
- [x] Resolve study context through the MCP-wrapped reference API.
- [x] Resolve site context through the MCP-wrapped reference API.
- [x] Handle ambiguous or mismatched sponsor, study, or site metadata without breaking the workflow.

## Catalog Matching

- [x] Fetch the sponsor-and-study-scoped catalog before matching invoice line items.
- [x] Match extracted invoice line items against the scoped catalog.
- [x] Handle larger catalog matching scenarios without workflow failure.
- [x] Preserve confidence, mismatch, and exception details from the matching step.

## Submit or Hold Decisioning

- [x] Decide whether each invoice should be submitted to ClinRun or held for exception handling.
- [x] Submit invoices that satisfy the automated decision criteria.
- [x] Withhold invoices that fail matching, context, confidence, or exception criteria.
- [x] Surface low-confidence outcomes as reviewable exceptions.
- [x] Make decision rationale understandable to reviewers.

## Hub Review Experience

- [x] Show what metadata and line items were extracted.
- [x] Show what invoice content was matched.
- [x] Show confidence values and exceptions.
- [x] Show whether the invoice was submitted or withheld.
- [x] Provide post-decision QC visibility for reviewers.
- [x] Support human review after AI decisioning.
- [x] Support corrections after AI decisioning.
- [x] Support rerun or escalation after AI decisioning.
- [x] Enable reviewers to understand outcomes and validate risk cases.
- [x] Keep core read and review interactions responsive. The hub now uses SSE for live invoice updates with polling fallback, sticky review actions, and lightweight local API reads.

## Required Sample Coverage

- [x] Demonstrate behavior on the simple sample invoice.
- [x] Demonstrate behavior on the medium sample invoice.
- [x] Demonstrate behavior on the large sample invoice.
- [x] Demonstrate behavior on the mismatched-metadata sample invoice.
- [x] Demonstrate behavior across easy invoice scenarios.
- [x] Demonstrate behavior across ambiguous invoice scenarios. The large sample and generator cover fuzzy/ambiguous/unmatched line-item behavior, and low-confidence matching is implemented and tested.
- [x] Demonstrate behavior across mismatched metadata scenarios.

## Reliability and Recovery

- [x] Maintain stable end-to-end processing across required sample invoices.
- [x] Provide predictable retry behavior when a workflow stage fails.
- [x] Provide predictable recovery behavior when a workflow stage fails.
- [x] Provide predictable retry or recovery behavior for low-confidence outcomes.
- [x] Preserve observable workflow state transitions for debugging and demo clarity.

## Architecture and Code Quality

- [x] Use a modular staged architecture.
- [x] Keep extraction, matching, and decisioning clearly separated.
- [x] Provide test coverage for core pipeline paths.
- [x] Provide test coverage for exception paths.
- [x] Include automated tests for core pipeline logic.
- [x] Make it obvious how decisions are reached.
- [x] Keep the implementation local-first unless a cloud dependency becomes necessary.

## Tooling and Delivery

- [x] Use Docker Compose for local orchestration or demo setup.
- [x] Use Git for source control.
- [ ] Document AI usage as part of the submission. Not found: no standalone AI usage documentation was present during review.
- [x] Account for the external take-home reference requirement at `https://github.com/ledgerrun/ai-takehome-test`.

## PRD Review Notes

- [ ] Clarify the incomplete code-quality sentence in `PRD.md`: "Submission quality should make it obvious how decisions are reached and how". Still unresolved in `PRD.md`.
- [ ] Clarify whether "submit to backend" and "submit to ClinRun" refer to the same destination. Still unresolved; implementation records submitted status but does not call a separate ClinRun submission endpoint.
- [ ] Clarify whether the hub must display numeric confidence scores, categorical confidence labels, or both. Still unresolved; implementation displays both in relevant areas.
- [ ] Clarify the expected format and depth of required AI usage documentation. Still unresolved; no AI usage documentation was found.
