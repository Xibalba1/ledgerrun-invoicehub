---
status: active
owner: engineering
last_reviewed: 2026-06-03
superseded_by:
---

# AGENTS.md

## Stack: TypeScript (incl. React/TSX), JSON, Python — nothing else by default
Other languages, runtimes, or config formats only when the task is *impossible* in these — a hard external constraint, not preference — and only after surfacing the constraint and the in-stack alternative you ruled out. Bash: throwaway one-liners only; anything reusable is TS or Python. Repo-owned config: JSON. Necessary boundaries are fine (SQL, `Dockerfile`, HTML/CSS via React, the one required CI YAML) — use them, don't expand them.
