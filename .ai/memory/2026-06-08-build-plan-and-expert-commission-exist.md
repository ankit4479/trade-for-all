---
title: Build plan and expert commission exist
type: fact
tags: saas,plan,personas,skills
source_tool: claude
created: 2026-06-08T13:01:38Z
---

Master plan is .ai/BUILD_PLAN.md (6 phases: de-risk -> data+RAG -> BYOK -> billing -> offline+polish -> harden). Stack: React+Vite PWA (evolve, not rewrite), Express/Fastify, Postgres+pgvector (ONE db), Drizzle, Stripe, Firebase Auth, KMS. Offline = read-only IndexedDB cache. Accuracy = verifiable/sourced/measured + eval harness. Expert persona skills in .ai/skills/: architect, ui-ux-designer, frontend-engineer, backend-engineer, security-engineer, devops-engineer, qa-tester - model-agnostic, chain them architect->design->build->security->devops->qa.
