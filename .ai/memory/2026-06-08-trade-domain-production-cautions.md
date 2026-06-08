---
title: Trade-domain production cautions
type: lesson
tags: saas,trade,compliance,risk
source_tool: claude
created: 2026-06-08T12:16:06Z
---

1) Preview model IDs gemini-3.1-pro-preview (gemini.ts:818) and gemini-3-flash-preview (gemini.ts:563) have no production SLA - pin to GA models before charging. 2) fetchRealTradeData (gemini.ts:216-226) FABRICATES duty rates from a string hash when the API fails - dangerous in a paid trade tool; replace with explicit 'data unavailable'. 3) It's a legal/trade product: hallucinated tariffs are liability, not just UX. Keep sourceUrl visible (schema already has it), show confidenceScore (already present), add 'verify with a licensed customs broker' disclaimer - and market 'every number is sourced' as a differentiator.
