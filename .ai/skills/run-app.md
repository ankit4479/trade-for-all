# Skill: run-app

**When to use:** the user asks to run, start, restart, or verify the Trade-for-All app locally.

**Steps:**
1. Ensure `.env` exists (copy from `.env.example` if missing) and has `GEMINI_API_KEY` set.
2. Confirm `server.ts` starts with `import 'dotenv/config';` — if not, add it (env won't load otherwise).
3. Start the server in the background: `npm run dev`.
4. Wait ~5s, then confirm the log shows `Server running on http://localhost:3000`.
   Also confirm the trade API keys print as PRESENT if they're set in `.env`.
5. The app is served on **http://localhost:3000** (Vite runs in Express middleware mode, not 5173).
6. After any `.env` or `firebase-applet-config.json` change, kill the server
   (`lsof -ti:3000 | xargs kill -9`) and restart — these are read at startup, not hot-reloaded.

**Done when:** the server logs the running URL and the page loads in the browser.
