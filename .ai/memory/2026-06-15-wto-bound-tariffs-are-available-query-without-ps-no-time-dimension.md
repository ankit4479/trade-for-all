---
title: WTO bound tariffs ARE available — query without ps (no time dimension)
type: fact
tags: wto,api,bound,tariff,schema,correction
source_tool: claude
created: 2026-06-15T12:55:25Z
---

Correction to earlier note: WTO bound-tariff indicators TP_B_0090/0180/0380 (simple avg bound: all/agri/non-agri) and TP_B_0020/0190/0390 (% bound lines) DO work. They return HTTP 400 'does not have a time period dimension' ONLY if you send ps=<year>. Omit ps entirely -> HTTP 200 with Year:null. Example: /data?i=TP_B_0090&r=356 -> India simple avg bound = 50.8%. Bound tariff = legal max ceiling a WTO member can charge (vs MFN applied = what they actually charge). These are reporter-level aggregates (no product code / no HS granularity). All 58 WTO indicators now tested: 50 return data w/ ps, 6 bound need no-ps, HS_P_0070 preferential is sparse (204 where no FTA).
