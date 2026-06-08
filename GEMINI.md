# Trade-for-All — Gemini CLI instructions

> Gemini reads this file automatically. Codex and Claude Code share the same brain via `.ai/`.

## Shared cross-model brain (DO THIS FIRST)
This repo has a **shared memory + skills** system in `.ai/`, used by Gemini CLI, Codex, and Claude
Code together. It is your long-term memory across sessions, shared with the other models — a lesson
any of them learned is available to you, and what you learn becomes available to them.

**At the start of every session, load the shared brain by running:**
```bash
.ai/bin/recall.sh
```
Read its output before doing repo work. (Or read `.ai/MEMORY.md` directly.)

**Whenever you learn something** — the user corrects you, you fix a mistake, or you discover a
non-obvious fact about this repo — record it so Codex and Claude benefit too:
```bash
AI_TOOL=gemini .ai/bin/remember.sh "Short title" "Lesson body — why + how to apply" lesson "tags"
```
Types: `lesson`, `mistake`, `fact`, `preference`. Don't duplicate — if `.ai/MEMORY.md` already has a
line covering it, edit that memory file in `.ai/memory/` instead of adding a new one.

**Before reinventing a procedure**, check `.ai/skills/` — shared, tool-agnostic skills you can run.

**Never** put secrets or API keys in `.ai/` — it is committed to the repo.

## Codebase graph (graphify) — shared with all models
The repo is mapped into `graphify-out/` (a knowledge graph). Before a non-trivial code change,
consult it instead of re-reading many files:
```bash
graphify query "how does login work"      # ask the graph
graphify path "MarketDetailModal" "Firestore"
graphify explain "fetchMarketDetails"
```
Or read `graphify-out/GRAPH_REPORT.md` for the human-readable overview. See `.ai/skills/use-graph.md`.
The graph **auto-rebuilds on every `git commit`** via a git post-commit hook (AST, no LLM). If
`graphify-out/graph.json` is missing (fresh clone), the full rebuild is a Claude Code command
(`/graphify .`). Run `graphify hook install` once per environment (git hooks aren't shared by the repo).

## Project
Global Trade Intelligence Engine — AI app for SME exporters (React 19 + Vite + Express proxy +
Gemini + Firebase). Details, run setup, and auth notes are in `.ai/memory/`. Key points:
- Run with `npm run dev` → served on **http://localhost:3000** (not 5173).
- Firebase config is in `firebase-applet-config.json`, not `.env`.
- `server.ts` must keep `import 'dotenv/config';` as its first line.
