---
title: Reference tables (hs_codes, hs_tariffs) have NO tenant_id
type: fact
tags: db,schema,postgres,tenant,rls,keys,reference,phase1
source_tool: claude
created: 2026-06-10T06:53:09Z
---

Architectural rule. Shared trade-reference data (hs_codes, hs_tariffs, jurisdictions, sources, countries) is IDENTICAL for every user -> store ONE copy, NO user_id/tenant_id. RLS = read-all-authenticated, write = service role (the loader) only. Adding tenant_id would duplicate WTO data per user AND break the shared-cache unit economics (the SaaS cost model). Tenant isolation (user_id + Postgres RLS) belongs ONLY on USER tables: user_products, classifications, subscriptions, usage. KEYS: hs_codes PK = composite (code, hs_edition) [same code means diff things across HS editions]. hs_tariffs PK = surrogate uuid id [soft-versioned] with the real uniqueness as a PARTIAL unique index on (reporter,partner,hs6,year,duty_type,hs_edition) WHERE superseded_by IS NULL = exactly one CURRENT row per logical fact while keeping history. Phase-1 initial DB = 2 core (hs_codes, hs_tariffs) + 3 supporting (jurisdictions, sources, ingestion_runs). Plan in .ai/PHASE_1_PLAN.md.
