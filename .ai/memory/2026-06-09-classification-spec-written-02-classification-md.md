---
title: Classification spec written (02-classification.md)
type: fact
tags: spec,classification,confidence,hscode,llm,accuracy
source_tool: claude
created: 2026-06-09T12:35:42Z
---

Classification de-risk spec at .ai/specs/02-classification.md, ADR-022..027. Builds ON TOP of MVP classifyProduct (gemini.ts:685). CORE RULES: (1) Confidence score is COMPUTED from real signals (S1 attribute completeness [the cap], S2 ambiguity resolution from user answers, S3 deterministic code-validity gate, S4 self-consistency, S5 optional image) NOT the LLM's self-report. (2) ONE user gate = PRODUCT IDENTITY (plain-English mirror + image), user confirms THEIR PRODUCT, never the HS code, because not knowing the code is why they came to us. (3) HS code shown as the ANSWER + validated deterministically against official nomenclature (no hallucinated codes). (4) Confidence bands High>=0.85/Medium/Low<0.60 gate the flow; still-Low gets honest 'verify with broker' flag. (5) Every confirm/correct = labeled signal -> compounding accuracy + calibration. Image is optional, required-on-low, confirms appearance + OCRs spec sheets, NEVER replaces clarifiers for non-visual attributes (material/use/specs). Cutoffs must be CALIBRATED not guessed.
