<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# NAVFarm

**Read `AGENTS.md` before planning or writing anything.** It carries the client,
the scope, the source-of-truth order, the script and master-data conventions,
the commands, and the open questions that are the client's to answer.

Two things it is worth repeating here, because they are the ones most often got
wrong:

- **`rak docs/` is not a source of truth.** The BBP, the TDD tracker, the master
  templates and what Rishi says are. An older briefing said the opposite.
- **Verify by driving the running app and reading MySQL, not by reading the
  code.** Every defect that mattered in this project passed its tests first.

## Current work — read this before planning anything

Work runs from **`docs/superpowers/plans/2026-09-14-mvp-delivery-plan.md`** (the roadmap) and the detailed plan of the current phase. Read **`docs/HANDOFF-2026-09-14-continuation.md`** first, then the original
`docs/HANDOFF-2026-09-14.md` for the client scope (`Project task list.docx`:
ten numbered items plus three follow-on). The continuation supersedes the
original's *status*; it does not replace its scope.

As of 14 Sep afternoon the foundation defects F1, F2, F3, F5 and F6 are fixed
and were verified by posting documents through the API and reading MySQL —
evidence in `docs/VERIFICATION-2026-09-14-*.md`. Do not redo them.

The lesson from that work still holds: **rows being present is not evidence,
and neither is a green suite.** Before 14 Sep every inventory, journal and
batch-cost row had been inserted by a seed script, and 582 tests passed over a
write path that had never run. Prove a write by making it and reading MySQL.
