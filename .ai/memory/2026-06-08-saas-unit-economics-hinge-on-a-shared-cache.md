---
title: SaaS unit economics hinge on a shared cache
type: fact
tags: saas,cost,caching,gemini
source_tool: claude
created: 2026-06-08T12:16:06Z
---

Caching is currently per-user (getTradeLawCacheId = law_USERID_..., getPulseCacheId = pulse_USERID_...), so identical routes (e.g. HS 6912 India->Germany) are re-paid by every user. Re-key the cache to hsCode+origin+destination (shared, with TTL: laws ~30d, pulse ~1h) so COGS scales with unique routes, not users. This is the single biggest margin lever. One Analyze click fires 15-30+ grounded Gemini calls (analyzeProduct + per-market fetchMarketDetails + fetchRealTradeData per destination + fetchTradePulse + askExpert on Pro), so realistic COGS is $0.30-$2 per session. A flat 'unlimited' plan loses money; meter on 'deep market analyses', not logins.
