---
title: Project is Global Trade Intelligence Engine
type: fact
tags: project
source_tool: claude
created: 2026-06-08T00:00:00Z
---

AI-first app for SME exporters: describe a product + origin country → Gemini classifies the
6-digit HS code (with a clarification wizard for ambiguity) → markets ranked Green/Yellow/Red →
deep-dive modal (`MarketDetailModal`, the central hub) pulls WTO tariffs + UN Comtrade volumes
(via the Express proxy in `server.ts`) + Gemini "Trade Pulse" news → landed-cost/profitability
sim → outputs: PDF export docs, "Talk to Expert" AI chat, Google Maps logistics map.

Stack: React 19 + TS + Vite + Tailwind + Framer Motion; D3+TopoJSON for the world heatmap;
Express proxy; Gemini (`src/services/gemini.ts`, wrapped in `withRetry` backoff); Firebase Auth
+ Firestore (used as an aggressive cache, keys via `getPulseCacheId`/`getTradeLawCacheId`).

Note: README is slightly stale — it says React 18 and documents `VITE_FIREBASE_*` env vars, but
the code actually reads Firebase config from `firebase-applet-config.json`.
