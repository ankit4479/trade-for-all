# Trade-for-All — Claude Code instructions

## Shared cross-model brain (READ THIS FIRST)
This repo has a **shared memory + skills** system in `.ai/`, used by Claude Code, Codex CLI, and
Gemini CLI together. Treat it as your long-term memory across sessions and across models.

- **At session start:** the `SessionStart` hook auto-runs `.ai/bin/recall.sh`, which loads
  `.ai/MEMORY.md` + recent `.ai/LEARNINGS.md` into your context. If for any reason it didn't,
  read `.ai/MEMORY.md` yourself before doing repo work.
- **When you learn something** (the user corrects you, you fix a mistake, or you discover a
  non-obvious repo fact): immediately record it so Codex and Gemini benefit too:
  ```bash
  AI_TOOL=claude .ai/bin/remember.sh "Short title" "Lesson body — why + how to apply" lesson "tags"
  ```
  Use type `mistake` for things that went wrong, `fact` for stable truths, `preference` for how
  the user wants things done. Don't duplicate — if `.ai/MEMORY.md` already covers it, edit that file.
- **Before reinventing a procedure**, check `.ai/skills/` — shared skills usable by all models.
- **Never** put secrets/API keys in `.ai/` (it's committed to the repo).

## Project
Global Trade Intelligence Engine — AI app for SME exporters. See `.ai/memory/` for the full
architecture, local-run setup, and Firebase/auth notes. Key points:
- Run with `npm run dev` → served on **http://localhost:3000** (not 5173).
- Firebase config lives in `firebase-applet-config.json`, not `.env`.
- `server.ts` must keep `import 'dotenv/config';` as its first line.
