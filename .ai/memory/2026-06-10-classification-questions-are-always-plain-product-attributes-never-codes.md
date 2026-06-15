---
title: Classification questions are ALWAYS plain product attributes, NEVER codes
type: preference
tags: classification,ux,questions,hscode,product
source_tool: claude
created: 2026-06-10T06:48:29Z
---

UX/design rule for classification. The customer never sees, picks, or is asked about HS codes/tariffs/customs jargon -- not knowing the code is why they came to us. Every clarifying question is plain language about the PHYSICAL product they're selling: material, size, purpose, function (e.g. 'Is it vacuum-insulated?', 'What's it made of?', 'For drinking or packaging?'). Each answer INTERNALLY eliminates candidate HS codes (walks chapter->heading->subheading) until one HS6 remains; we then SHOW that code as the answer + an example image. The code<->option mapping (e.g. '0.5-1L -> 9617.12') is internal and hidden. This applies identically to HS-edition split resolution: the customer just answers a normal product question (e.g. capacity), never told it's due to a code split.
