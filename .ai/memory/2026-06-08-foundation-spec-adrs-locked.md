---
title: Foundation spec ADRs locked
type: fact
tags: spec,architecture,foundation,adr
source_tool: claude
created: 2026-06-08T21:19:28Z
---

00-foundation.md is the cross-cutting source of truth. Locked: Express 5 (not Fastify), pg-boss on Postgres (not Redis/BullMQ), Supabase Postgres+RLS (keep Firebase Auth, not Supabase Auth), GCP KMS envelope encryption, gemini-embedding-001 @ 1536 dims MRL-truncated, gemini-2.5-flash + gemini-2.5-pro GA (preview models in gemini.ts are FORBIDDEN), gemini-2.5-flash LLM-reranker, pgvector HNSW vector_cosine_ops, SSE (not WebSocket). API base /api/v1, ok-envelope, Resolved<T> designed-unknown shape replaces the fabricated fallback at gemini.ts:216-226. Schema.ts has all 13 tables with RLS-by-app.user_id.
