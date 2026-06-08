# Shared Skills

Plain-markdown skills usable by **any** model in this repo (Codex, Gemini, Claude Code).
Each `*.md` file is one skill or expert persona. Read the file and follow it.

The shared, tool-agnostic contract: a skill has a clear **when to use**, **operating principles /
steps**, and a **Definition of Done / checklist**. Every model is instructed (in CLAUDE.md /
AGENTS.md / GEMINI.md) to check here before reinventing a procedure.

To add a skill: drop a new `<name>.md` here following an existing one, then it's available to all tools.

## Procedural skills
- `run-app.md` — start the dev server correctly and verify it's up.
- `capture-learning.md` — record a lesson into shared memory (auto-learning).
- `use-graph.md` — read/rebuild the graphify codebase map.
- `wto-byok-onboarding.md` — connect a user's own WTO API key (verified flow + security).

## Expert "commission" personas (model-agnostic)
Invoke a persona by reading its file and adopting its identity + checklist. Chain them:
architect → ui-ux-designer → frontend/backend-engineer → security-engineer → devops-engineer → qa-tester.
- `architect.md` — cross-cutting design decisions, keeps it lightweight + measurable.
- `ui-ux-designer.md` — enterprise UX, all states, trust signals, accessibility.
- `frontend-engineer.md` — lean React, PWA/offline, no client secrets.
- `backend-engineer.md` — secure API, RAG, caching, BYOK, metering.
- `security-engineer.md` — defense-in-depth checklist (the security gate).
- `devops-engineer.md` — lightweight infra, CI/CD, secrets, observability.
- `qa-tester.md` — unhappy-path + security + accuracy-harness testing (the quality gate).

See `.ai/BUILD_PLAN.md` for the overall plan these personas execute.
