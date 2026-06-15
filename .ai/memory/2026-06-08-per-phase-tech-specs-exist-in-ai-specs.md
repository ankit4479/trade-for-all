---
title: Per-phase tech specs exist in .ai/specs/
type: fact
tags: specs,plan,architecture,schema,roadmap
source_tool: claude
created: 2026-06-08T21:27:26Z
---

BUILD_PLAN.md is strategy-level (a summary/crux). The buildable detail lives in .ai/specs/: 00-foundation.md (14 ADRs + complete Drizzle schema for all 13 tables + API conventions + provenance/freshness types — the single source of truth) and phase-0..6 specs, each authored through its owning persona skill and referencing the foundation. Specs contain real DDL/TypeScript/endpoint contracts/prompts/thresholds/test plans, not prose. Build from .ai/specs/, not from BUILD_PLAN alone. ADRs locked: Express 5 + pg-boss (one Postgres), Supabase Postgres + RLS + pgvector HNSW, Firebase Auth kept, GA Gemini only (gemini-2.5-flash/pro — NO preview), gemini-embedding-001@1536 dims, SSE for streaming.
