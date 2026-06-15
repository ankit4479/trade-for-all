---
title: Data backbone spec written (01-data-backbone.md)
type: fact
tags: spec,data,hscode,ingestion,backbone,classification
source_tool: claude
created: 2026-06-09T11:50:13Z
---

The canonical trade-data engine spec lives at .ai/specs/01-data-backbone.md. Extends 00-foundation with ADR-015..021: bloc->member-state jurisdiction model (EU/GCC are blocs; duty attaches to bloc, tax/compliance to member country), two-layer HS (international HS6 spine in hs_codes + national_tariff_lines for HTS/TARIC/ITC-HS), first-class sources registry, tiered ingestion (API>bulk_file>html>digital_pdf>OCR last-resort, every non-API path validated), freshness policy (volatility classes + publication-watcher + FRESH/STALE/EXPIRED). Covers 5 corridors IN->US/EU/UK/UAE/AUS. KEY INSIGHT: HS code is the fast-lookup index, but the real accuracy risk is UPSTREAM classification (product->correct HS6); LLM may produce HS6 (a category) but NEVER a number (duty/tax). 4 deferred forks in spec section 8 (UAE compliance depth, US state tax, build-vs-buy, EU labeling).
