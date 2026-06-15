---
title: WTO tariff proxy in server.ts is broken (wrong API path)
type: mistake
tags: wto,api,server,tariff,endpoint,schema
source_tool: claude
created: 2026-06-15T12:34:10Z
---

server.ts:84 calls https://api.wto.org/tariff/v1/tariff?... which returns HTTP 404 (path does not exist) — the catch swallows it as {data:[]}, so WTO tariffs have NEVER worked. CORRECT API = WTO Timeseries: https://api.wto.org/timeseries/v1/data?i=<indicator>&r=<isoNumeric>&pc=<hsCode>&ps=<year>&fmt=json. Tariff indicators are HS_A_0010 (MFN simple avg ad valorem %), HS_A_0020 (max ad valorem), HS_A_0030 (duty-free line count), HS_A_0040 (national tariff line count), HS_A_0050 (NAV/non-ad-valorem line count), HS_P_0070 (lowest preferential at HS6). Each indicator is a separate call; assemble one hs_tariffs row from several. Resolves at HS 2/4/6 but coverage is reporter+year-specific (e.g. USA 090111 present, India 090111 absent though India 0901 present). REPORTER CODES DIFFER: Comtrade reporterCode=M49 (USA=842); WTO ReportingEconomyCode=ISO-3166 numeric (USA=840) — jurisdictions.apiCodes{comtrade,wto} must hold both. WTO endpoints: /indicators, /reporters (code+iso3A+name), /products, /data.
