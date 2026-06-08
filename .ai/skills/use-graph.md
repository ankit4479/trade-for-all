# Skill: use-graph (graphify codebase map)

**When to use:** you need to understand the codebase architecture, find how things connect, or
locate the right file/function before making a change. Use the graph instead of re-reading many files.

The repo is mapped by **graphify** into `graphify-out/` (a knowledge graph of the codebase).
This is shared context every model should consult.

**Read the graph:**
- Quick human-readable overview: read `graphify-out/GRAPH_REPORT.md` (god nodes, communities,
  surprising connections).
- Raw graph data: `graphify-out/graph.json`.
- Ask the graph a question (BFS over the graph, cheap):
  ```bash
  graphify query "how does login work"
  graphify path "MarketDetailModal" "Firestore"
  graphify explain "fetchMarketDetails"
  ```

**Rebuild / keep it fresh:**
- The graph **auto-rebuilds on every `git commit`** via the installed git post-commit hook
  (AST-only, no LLM, free). So after committing code, the graph is current.
- If `graphify-out/graph.json` is MISSING (e.g. a fresh clone), regenerate it:
  - Claude Code: run `/graphify .`
  - Codex / Gemini: run `graphify` is a CLI for query only; for a full rebuild ask the user to run
    `/graphify` in Claude Code, OR do an AST refresh by making any commit (the hook rebuilds it).
- The git hook lives in `.git/hooks/` which is NOT shared by the repo. **Each environment must run
  `graphify hook install` once** to enable auto-rebuild-on-commit.

**Rule:** before a non-trivial code change, consult the graph (`GRAPH_REPORT.md` or `graphify query`)
to find the relevant nodes and their connections. After committing, trust the graph is up to date.
