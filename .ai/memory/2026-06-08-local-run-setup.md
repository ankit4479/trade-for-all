---
title: Local run setup
type: fact
tags: setup,env
source_tool: claude
created: 2026-06-08T00:00:00Z
---

Run with `npm run dev` — this runs `tsx server.ts`, an Express server that serves the Vite app
in middleware mode. The app is served on **http://localhost:3000** (NOT Vite's default 5173).

`.env` keys (gitignored, copy from `.env.example`):
- `GEMINI_API_KEY` — required for all AI features
- `VITE_GOOGLE_MAPS_PLATFORM_KEY` — must use the `VITE_` prefix so Vite exposes it to the browser;
  read in `src/App.tsx`. Needs Maps JavaScript API + Geocoding API + Places API (New) enabled,
  plus a real Map ID (code hardcodes `mapId="LOGISTICS_MAP_ID"` in MarketDetailModal.tsx).
- `UN_COMTRADE_API_KEY`, `WTO_API_KEY` — optional; enable "authoritative" data mode.
- `APP_URL` — set to `http://localhost:3000` for local dev.

GOTCHA: `server.ts` originally did NOT load dotenv, so env vars were ignored. Fix already applied:
`import 'dotenv/config';` is the first line of server.ts. Keep it.

Env changes require a dev-server restart (Vite reads .env and server reads process.env at startup).
