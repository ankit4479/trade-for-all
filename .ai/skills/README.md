# Shared Skills

Plain-markdown skills usable by **any** model in this repo (Codex, Gemini, Claude Code).
Each `*.md` file here is one skill: a repeatable procedure with steps the model follows.

Because the three CLIs have different native "skill" formats, the shared, tool-agnostic contract
is simple: **a skill is a markdown file with a `name`, a `when to use`, and numbered `steps`.**
Every model is instructed (in CLAUDE.md / AGENTS.md / GEMINI.md) to:

1. Check this folder when a task matches a skill's "when to use".
2. Read the skill file and follow its steps.

To add a skill: drop a new `<skill-name>.md` here following the template in any existing skill,
then it's instantly available to all three tools.

## Available skills
- `run-app.md` — start the dev server correctly and verify it's up.
- `capture-learning.md` — how to record a lesson into shared memory (used for auto-learning).
