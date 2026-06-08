---
title: BUILD_PLAN is now v2 with accuracy-ops + perceived-performance
type: fact
tags: plan,accuracy,performance,roadmap
source_tool: claude
created: 2026-06-08T14:15:38Z
---

BUILD_PLAN.md upgraded to v2: added accuracy-operations layer (tiered freshness TTLs not flat 6mo, source-conflict precedence expert>WTO>Comtrade>LLM, data_corrections human-in-loop override table, citation verification, retrieval rerank+confidence gating, eval-set owned by trade-customs-expert + model-drift CI gate, 'data unavailable' as designed state) and perceived-performance layer (SSE streaming of analysis, async job queue on pg-boss, cache pre-warming, cost circuit-breaker). Added per-phase EXIT METRICS, Strangler-Fig migration Firestore->Postgres, full 16-persona reference. New phase order: 0 de-risk -> 1 data+RAG+accuracy -> 2 smooth UX -> 3 BYOK -> 4 billing+compliance -> 5 offline+corrections UI -> 6 harden. Never charge for fast-but-wrong data.
