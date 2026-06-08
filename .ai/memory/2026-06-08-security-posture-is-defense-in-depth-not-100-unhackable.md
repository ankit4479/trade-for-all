---
title: Security posture is defense-in-depth, not 100% unhackable
type: lesson
tags: security,architecture,saas
source_tool: claude
created: 2026-06-08T13:01:38Z
---

Honest framing (like accuracy): no system is 100% unhackable. Goal = defense-in-depth vs all KNOWN attack classes + minimal blast radius. Layers (see security-engineer skill + BUILD_PLAN section 6): no client secrets; no direct client DB/cache writes (all writes via validated API); server-verified Firebase token + RBAC + Postgres RLS by user_id; parameterized SQL (Drizzle); prompt-injection defense (retrieved/user text = data not instructions, schema-validated output, LLM has NO DB write); XSS-safe markdown; rate limits + WAF + DDoS; zod input validation; fix the 28 npm vulns; SAST/DAST + pen-test pre-launch.
