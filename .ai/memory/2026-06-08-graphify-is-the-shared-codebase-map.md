---
title: Graphify is the shared codebase map
type: fact
tags: graphify,memory,setup
source_tool: claude
created: 2026-06-08T11:49:53Z
---

All models read the codebase graph in graphify-out/ (GRAPH_REPORT.md or 'graphify query/path/explain'). The graph auto-rebuilds on every git commit via the graphify post-commit hook (AST-only, free). Git hooks live in .git/hooks and are NOT shared by the repo, so each environment must run 'graphify hook install' once. Verified live: Gemini read both shared memory and graphify successfully.
