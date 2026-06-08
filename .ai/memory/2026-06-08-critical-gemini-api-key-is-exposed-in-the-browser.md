---
title: CRITICAL: Gemini API key is exposed in the browser
type: mistake
tags: security,saas,gemini,architecture
source_tool: claude
created: 2026-06-08T12:16:06Z
---

vite.config.ts:11 injects GEMINI_API_KEY into the client bundle via define, and src/services/gemini.ts runs in the browser (new GoogleGenAI with the key). Anyone can extract the key from DevTools and run unlimited bills. SaaS blocker #1: ALL Gemini calls must move server-side (into server.ts/API layer); the browser should call our authenticated API, never Gemini directly. Everything else in the SaaS plan depends on this.
