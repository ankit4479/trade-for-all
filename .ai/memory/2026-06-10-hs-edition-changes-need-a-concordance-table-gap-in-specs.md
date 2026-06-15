---
title: HS edition changes need a concordance table (GAP in specs)
type: fact
tags: hscode,concordance,edition,wco,classification,gap,spec
source_tool: claude
created: 2026-06-10T06:48:40Z
---

When WCO revises HS (every ~5yrs: HS2017->HS2022->HS2028) a product's code can move ('changed by 1 number' usually = last 2 subheading digits shift). Specs stamp hsEdition on hs_codes/hs_tariffs but currently have NO concordance mechanism -- to add as a new ADR. Design: hs_concordance table (fromEdition,fromCode,toEdition,toCode,relationship). Load WCO/UN correlation tables on each new edition. Three cases: 1:1 renumber -> auto re-point silently; merge (many:1) -> auto collapse; split (1:many) -> CANNOT auto-pick. Split handling = TWO STEP: (1) try auto-resolve from attributes we ALREADY know (stored description + prior answers + spec-sheet OCR); (2) only if still ambiguous, ask ONE plain-language product question using the SAME spec-02 generator but fed the concordance successors as candidates. Options are validated real successors; LLM only phrases, never invents/picks (ADR-020/022). Always include 'not sure/none' -> honest escalation, NEVER silent guess. Yearly nomenclature re-check is what catches the edition boundary. Customer never knows it's a code split -- just answers a normal product question.
