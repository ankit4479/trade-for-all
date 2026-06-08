# `.ai/` — Shared Cross-Model Brain

One memory and one skill set, shared by **Codex CLI**, **Gemini CLI**, and **Claude Code** in this repo.
Switch models in any session and the new model already knows what the others learned.

## Layout
```
.ai/
  MEMORY.md      ← index: one line per memory. Read this FIRST every session.
  LEARNINGS.md   ← append-only log of mistakes → corrections (auto-learning).
  memory/        ← one markdown file per fact/lesson (the actual brain).
  skills/        ← tool-agnostic skills (markdown procedures) any model can run.
  bin/
    recall.sh    ← prints the whole shared brain (run at session start).
    remember.sh  ← writes a new memory (run when you learn something).
```

## How each tool plugs in
- **Claude Code** — `/CLAUDE.md` points here; a `SessionStart` hook in `.claude/settings.json`
  runs `recall.sh` automatically so the brain loads every session with no action needed.
- **Codex CLI** — reads `/AGENTS.md`, which instructs it to run `recall.sh` first and
  `remember.sh` when corrected.
- **Gemini CLI** — reads `/GEMINI.md`, same instructions.

## The two commands (work from any tool's shell)
```bash
# Load the shared brain
.ai/bin/recall.sh

# Save a lesson (set AI_TOOL so we know who learned it)
AI_TOOL=codex .ai/bin/remember.sh "Title" "The lesson body" lesson "tag1,tag2"
```

## Rules (followed by all models)
1. **Read before acting.** Run `recall.sh` (or read `MEMORY.md`) at session start.
2. **Write when you learn.** On a correction, fix, or new repo fact → `remember.sh`.
3. **Don't duplicate.** If a memory already covers it, edit that file instead of adding a new one.
4. **Don't store secrets.** Memories are committed; never put API keys or credentials here.
5. **Share skills.** Before reinventing a procedure, check `.ai/skills/`.
