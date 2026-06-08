#!/usr/bin/env bash
# recall.sh — print the shared cross-model memory for loading into context.
# Claude Code runs this automatically at session start (see .claude/settings.json).
# Codex and Gemini are instructed to run it at the start of a session.
set -euo pipefail

AI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "===== SHARED CROSS-MODEL MEMORY (.ai) ====="
echo "Codex, Gemini, and Claude Code all share this brain. Read it before acting."
echo

if [ -f "$AI_DIR/MEMORY.md" ]; then
  cat "$AI_DIR/MEMORY.md"
else
  echo "(no memories yet)"
fi

echo
if [ -f "$AI_DIR/LEARNINGS.md" ]; then
  echo "----- Recent learnings (last 30) -----"
  tail -n 30 "$AI_DIR/LEARNINGS.md"
fi

echo
if [ -d "$AI_DIR/skills" ]; then
  SKILLS=$(find "$AI_DIR/skills" -maxdepth 1 -name '*.md' ! -name 'README.md' -exec basename {} \; 2>/dev/null || true)
  if [ -n "$SKILLS" ]; then
    echo "----- Shared skills (read the file before using) -----"
    echo "$SKILLS"
  fi
fi
echo "===== END SHARED MEMORY ====="
