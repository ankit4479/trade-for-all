#!/usr/bin/env bash
# remember.sh — append a lesson/fact to the shared cross-model memory.
# Every model (Codex, Gemini, Claude Code) writes through this ONE script so
# the format stays identical no matter who learned the lesson.
#
# Usage:
#   remember.sh "Short title" "The lesson or fact body" [type] [tags]
#     type: lesson | mistake | fact | preference | skill-note   (default: lesson)
#     tags: comma-separated, optional
#
# Set AI_TOOL=codex|gemini|claude in the environment to record who learned it.
set -euo pipefail

AI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEM_DIR="$AI_DIR/memory"
INDEX="$AI_DIR/MEMORY.md"
LEARN="$AI_DIR/LEARNINGS.md"
mkdir -p "$MEM_DIR"

TITLE="${1:?usage: remember.sh \"title\" \"body\" [type] [tags]}"
BODY="${2:?usage: remember.sh \"title\" \"body\" [type] [tags]}"
TYPE="${3:-lesson}"
TAGS="${4:-}"
TOOL="${AI_TOOL:-unknown}"

SLUG=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$SLUG" ] || SLUG="note"
DATE=$(date -u +"%Y-%m-%d")
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

FILE="$MEM_DIR/${DATE}-${SLUG}.md"
i=2
while [ -e "$FILE" ]; do FILE="$MEM_DIR/${DATE}-${SLUG}-${i}.md"; i=$((i+1)); done

cat > "$FILE" <<EOF
---
title: $TITLE
type: $TYPE
tags: $TAGS
source_tool: $TOOL
created: $TS
---

$BODY
EOF

# Ensure index exists, then add one line
if [ ! -f "$INDEX" ]; then
  printf '# Shared Memory Index\n\nOne line per memory. Every model reads this first.\nWrite new memories with `.ai/bin/remember.sh`.\n\n' > "$INDEX"
fi
printf -- '- [%s](memory/%s) — %s%s _(%s, %s)_\n' \
  "$TITLE" "$(basename "$FILE")" "$TYPE" "${TAGS:+ · $TAGS}" "$TOOL" "$DATE" >> "$INDEX"

# Mistakes & lessons also go into the append-only learnings log
if [ "$TYPE" = "lesson" ] || [ "$TYPE" = "mistake" ]; then
  if [ ! -f "$LEARN" ]; then
    printf '# Learnings Log\n\nAppend-only. Mistakes and their corrections, newest at the bottom.\n\n' > "$LEARN"
  fi
  printf -- '- **%s** (%s) — %s: %s\n' "$DATE" "$TOOL" "$TITLE" "$BODY" >> "$LEARN"
fi

echo "✓ remembered: $FILE"
