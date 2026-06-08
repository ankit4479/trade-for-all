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

## Expert "commission" personas — 16 seats, model-agnostic
Each persona is modeled on named best-in-class practitioner(s), currency-verified via web research
(2026). Invoke one by reading its file and adopting its identity + Definition-of-Done checklist.
`delivery-orchestrator` decides which personas run and in what order.

**Product & domain**
- `product-manager.md` — Cagan + Teresa Torres (Continuous Discovery) + Doshi + Lenny.
- `trade-customs-expert.md` — licensed customs broker / WCO HS rules. The **accuracy authority**.
- `growth-pricing.md` — Kyle Poyar (Growth Unhinged) + Elena Verna + Campbell foundations.
- `delivery-orchestrator.md` — Will Larson + Camille Fournier. The conductor (meta).

**Design & engineering**
- `architect.md` — Martin Fowler + modern SaaS reference stack.
- `ui-ux-designer.md` — Karri Saarinen/Linear + Rams + Norman.
- `frontend-engineer.md` — Addy Osmani + shadcn/ui + Tailwind.
- `backend-engineer.md` — Kleppmann + DHH + Supabase/Neon + Drizzle.
- `ai-rag-engineer.md` — Hamel Husain + Jason Liu (evals-first RAG).
- `data-engineer.md` — analytics engineering (dbt / Tristan Handy).
- `payments-billing-engineer.md` — Stripe billing patterns.

**Quality, ops, trust**
- `security-engineer.md` — Tanya Janca + OWASP Top 10 + **OWASP LLM Top 10 (2025)**. Security gate.
- `qa-tester.md` — Kent C. Dodds (Testing Trophy) + Kent Beck (TDD) + Lisa Crispin + LLM evals. Quality gate.
- `devops-engineer.md` — Charity Majors + Google SRE (incl. Network & edge).
- `legal-compliance-privacy.md` — privacy-by-design / IAPP / GDPR.
- `technical-writer.md` — Diátaxis (Daniele Procida) + Stripe docs bar.

See `.ai/BUILD_PLAN.md` for the overall plan these personas execute.
