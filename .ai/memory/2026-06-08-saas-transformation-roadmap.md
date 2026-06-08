---
title: SaaS transformation roadmap
type: fact
tags: saas,roadmap,billing,stripe,architecture
source_tool: claude
created: 2026-06-08T12:16:06Z
---

Phase 0 (non-negotiable, first): move all Gemini calls server-side, remove key from client bundle, add auth middleware verifying Firebase ID token. Phase 1: server-side usage counters + quota gate + shared route-keyed cache. Phase 2: Stripe Checkout + Customer Portal + webhooks -> Firebase custom claims for plan+role (replace hardcoded admin email in firestore.rules:28). Phase 3: usage dashboard + upgrade-at-quota-wall. Phase 4: move off preview models to GA, observability, rate limiting, team seats. ~8-11 weeks total. Server-authoritative quota only (never trust client for analyses-remaining); increment usage in a Firestore transaction before calling Gemini.
