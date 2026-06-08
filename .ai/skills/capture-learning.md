# Skill: capture-learning

**When to use:** the user corrects you, you discover a non-obvious fact about this repo, you fix a
mistake, or the user says "remember this." This is how every model contributes to the shared brain.

**Steps:**
1. Distill the lesson into one short title and a 1–4 sentence body. Capture the *why* and the
   *how to apply it next time*, not just what happened.
2. Pick a type: `lesson` (general takeaway), `mistake` (something that went wrong + the fix),
   `fact` (stable truth about the repo), `preference` (how the user wants things done).
3. Write it via the shared script so the format is identical across all models:
   ```bash
   AI_TOOL=<codex|gemini|claude> .ai/bin/remember.sh "Short title" "The lesson body" <type> "tag1,tag2"
   ```
4. The script creates `.ai/memory/<date>-<slug>.md`, adds a line to `.ai/MEMORY.md`, and (for
   `lesson`/`mistake`) appends to `.ai/LEARNINGS.md`.
5. Do NOT duplicate: if `.ai/MEMORY.md` already has a line covering this, edit that memory file
   instead of writing a new one.

**Done when:** `remember.sh` prints `✓ remembered: ...` and the index shows the new line.
