---
status: active
owner: engineering
last_reviewed: 2026-06-07
superseded_by:
---

# AI Usage

LedgerRun uses AI as an engineering accelerator, not as an unchecked source of truth. [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) is the primary AI-assisted development workflow for this project: it helps inspect the codebase, plan bounded changes, implement code, review diffs, and verify behavior. The engineer remains responsible for scope, design judgment, final code review, and deciding whether a change is ready to ship.

## Development Workflow

AI-assisted work follows a red-green-refactor loop whenever behavior changes:

1. **Red: capture the expected behavior first.** Start by writing or updating a failing test that names the missing behavior, bug, or contract. Prefer focused tests near the changed code, and add integration coverage when the change crosses API, pipeline, storage, or UI boundaries.

2. **Green: make the smallest useful change.** Use Compound Engineering to implement the narrowest code needed to satisfy the failing test. Keep changes within the existing TypeScript, React, JSON, and Python stack unless a hard external constraint requires otherwise.

3. **Refactor: improve clarity after proof.** Once tests pass, simplify names, boundaries, and duplication while preserving the verified behavior. Refactoring should not expand scope or mix unrelated cleanup into the same change.

4. **Verify: run the relevant checks.** Run the smallest meaningful test target during iteration, then run the broader project checks before handoff when the blast radius justifies it.

## Compound Engineering Practices

Compound Engineering should be used to make the development process more disciplined:

- Read local context before changing code, including contracts, tests, docs, and nearby patterns.
- Turn vague work into a short plan with explicit acceptance criteria.
- Prefer deterministic code and runtime validation around model output, especially in invoice extraction, matching, decisioning, and reviewer workflows.
- Keep AI-generated code small enough to review carefully.
- Ask AI reviewers to look for regressions, missing tests, trust-boundary failures, and user-facing workflow breaks.
- Record important implementation decisions in project docs when they affect future contributors.

## Guardrails

AI output must be treated as a draft until it is tested, reviewed, and understood. Do not accept code that cannot be explained by the engineer. Do not rely on model responses for correctness where deterministic checks, schemas, fixtures, or tests can enforce the rule. Do not allow AI convenience to bypass privacy, security, auditability, or clinical-trial finance controls.

The preferred outcome of AI usage is not more code faster. It is a tighter feedback loop: failing test, minimal fix, passing verification, clear review, and documented intent.
