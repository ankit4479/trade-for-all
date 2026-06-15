---
title: WTO and Comtrade APIs answer DIFFERENT questions (MVP conflates them)
type: fact
tags: wto,comtrade,api,research,classification,hscode,tariff
source_tool: claude
created: 2026-06-09T13:54:09Z
---

RESEARCH (verified vs docs + server.ts proxies). UN Comtrade (comtradeapi.un.org/data/v1/get/C/A/HS) returns TRADE-FLOW STATS ONLY: primaryValue (USD), netWgt/grossWgt (kg), qty -- keyed by reporterCode(importer), partnerCode(exporter), cmdCode(HS), period, flowCode(M/X). It is for market-demand sizing, NOT duty. WTO Tariff (api.wto.org/tariff/v1/tariff) returns TARIFF RATES at HS6 ONLY: MFN applied + bound (IDB+CTS), keyed by r=reporter, pc=HS6, p=000. NEITHER gives VAT/GST, NEITHER gives compliance/certs, NEITHER gives national HS8/HS10 -- those are the backbone's OTHER sources (TARIC/Access2Markets/national). Both use NUMERIC country codes (M49 for Comtrade; e.g. India=699, USA=842) -> needs jurisdictions.iso_numeric mapping (already in 01-data-backbone schema). WTO 404s often when reporter/year missing. KEY CLASSIFICATION LINK: both APIs are keyed on ONE HS6, so each clarifying question must resolve an HS-tree branch between candidate codes (e.g. insulated bottle: vacuum?->9617.00, else steel?->7323.93, plastic drinkware?->3924.10, packaging?->3923.30). MVP's gemini.ts:188 wrongly asks the LLM to fill duty/tax gaps -- close that.
