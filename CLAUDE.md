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

**`docs/HANDOFF-2026-09-14.md`** is the live handoff. It carries the client's own
`Project task list.docx` scope (ten numbered items plus three follow-on), the
four shared defects that block nine of them, the state of the tree, and how to
drive the running app. Read it first; it will save you a day of re-deriving.

The one finding to absorb before you touch anything: **no document has ever been
posted through the API in this database.** Every inventory, journal and
batch-cost row was inserted directly by a seed script. 582 tests pass over a
write path that has never run. Rows being present is not evidence, and neither
is a green suite.
