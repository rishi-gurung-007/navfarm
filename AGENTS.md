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

# NAVFarm — read this before planning or writing anything

Everything below the Nx block replaces an earlier version of this file that is
now wrong in ways that will send you to the wrong documents and the wrong
conclusions. Where this file and your instincts disagree, this file wins; where
this file and Rishi disagree, **Rishi wins** — say so and update this file.

## 1. Who and what

- **Client:** Triple C (Colcom Group), Zimbabwe. **Scope: NOB Livestock → LOB
  Piggery only.** Sixteen LOBs exist as taxonomy; nothing but piggery is in
  scope. Do not build out poultry/dairy/aqua screens unless asked.
- **One maintainer: Rishi.** `apps/api` (NestJS 11 + Drizzle + MySQL),
  `apps/web` (Next.js 16 + React 19), `apps/mobile` (Flutter, only on request),
  `apps/web-e2e` / `apps/api-e2e` (Playwright).
- **The backend is in scope.** An older version of this file said "do not
  authorize backend implementation in the current frontend-only phase". That is
  obsolete. Auth, master data, batches, animals, breeding and costing are real
  endpoints against a real database.
- A second developer, Arun, used to land commits on shared branches. **Review
  anything you did not write** rather than assuming it is correct.

## 2. Source of truth

**Rishi is the source of truth.** Not the BBP, not the TDD tracker, not the
templates. Every document in this repo is *reference* — evidence of what the
client has said so far — and every one of them is incomplete, unsigned, or
contradicts another. What the application should do is what Rishi says it
should do.

That is not a formality. The BBP is unsigned (§18's approval boxes are all
empty), the BBP and the TDD tracker disagree on stage names and on the animal
code prefix, and the BBP contradicts itself on the reporting currency. There is
no document you can defer to in order to avoid asking.

**`docs/decisions.md` is the record of what Rishi has decided.** Read it before
planning. Add to it when he decides something new — the decision, the date, and
the reasoning, so the next agent does not re-ask a settled question or quietly
reverse it.

Reference material, most useful first:

1. **`TDD_Triple-C Development Testing_Tracker`** — 143 numbered requirement
   rows, the most specific statement of what each screen must do. Quote row
   numbers in commit messages.
2. **`OneDrive_1_04-09-2026/`** — the latest client material: BBP-1 in
   `Solution Documents/`, the eight `Master Templates/`, and the `MOMs/`.
3. **`rak docs/`** — older, superseded. Reference only, and rarely worth
   opening. An earlier version of this file called it the Product Source of
   Truth; it never was.

When two documents disagree, or when a document is silent, **ask Rishi** and
then record the answer. Do not pick one silently and do not invent a third.

### Reading the client documents

They are `.docx` / `.xlsx`, so read them as zip archives:

```bash
mkdir -p /tmp/doc && cd /tmp/doc && unzip -q "<file>.docx"   # then parse word/document.xml
mkdir -p /tmp/xl  && cd /tmp/xl  && unzip -q "<file>.xlsx"   # xl/worksheets/sheet1.xml + xl/sharedStrings.xml
```

`openpyxl` is not installed. Do not claim a field is absent from a document you
have not opened.

## 3. How to work here

- **Drive the running app. Reading the code is not verification.** Nearly every
  defect that mattered in this project passed its tests and read correctly:
  a slaughter recorded with the food-safety check skipped, a number series that
  had never once issued a code, an animal panel contradicting itself. Each was
  found by clicking, or by calling the API and then looking in MySQL.
- **Check the database after a write.** `mysql -u root nf_devco -e "..."`.
  A 200 response is not proof the row is right.
- **Never invent client data.** No placeholder company names, no example
  identifiers, no "typical" values dressed as the client's. If a document does
  not give an example, use none. (Real bug: Indian demo placeholders —
  `greenvalleyfarms.in`, `GSTIN12345`, `Asia/Kolkata` — shipped on a Zimbabwe
  piggery's screens.)
- **Say what a document says, then what we did.** If a field has no document
  behind it, label it as ours. Do not present an invention as a requirement.
- **Ask when a decision is the client's.** Residual value per-kg vs percentage,
  ZWL vs ZiG, what "weaning" means — these are not yours to settle.

## 4. Conventions that already exist — follow them, don't reinvent

- **Data-changing scripts** live in `apps/api/src/scripts/`, are registered as
  `db-*` Nx targets, and follow one shape: **read-only by default, `--verify`
  applies inside a transaction and rolls back, `--apply` commits.** They print
  a reviewable plan and refuse to touch tables that already hold rows. See
  `configure-demo-master-series.ts`, `align-stages-to-tdd.ts`,
  `seed-demo-breeding-chain.ts`. Always run `--verify` and read the plan first.
- **Master data is config-driven.** One registry,
  `apps/web/src/modules/master-data/configs.ts`, feeds `MasterDataTable` for
  all ~23 masters through the single route `/master-data/[key]`. Add a config
  entry; do not add a page.
- **Guard specs in `apps/web/specs/`** enforce cross-cutting rules —
  `role-permissions-coverage`, `nav-scope-consistency`,
  `master-data-singular-label`, `finance-sections`. If one fails, it has
  usually caught something real. Read it before changing it.
- **Design:** `apple.design.md` is the authority. §19: "Do not create one-off
  label/input markup when the shared Field primitive is appropriate." Use
  `Field`, `ReadField`, `FieldGroup`, `ConsolePage`, `PageHeader`.
- **Scope headers** the API expects: `x-tenant-id`, `x-active-company-id`,
  `x-workspace-scope` (`TENANT` | `COMPANY` | `OPERATIONAL`). Master scope
  matching is exact — a company-scoped row is invisible to a tenant-scoped
  query and the reverse. This has caused real bugs; see `master-data-scope.ts`.

## 5. Commands

```bash
pnpm nx test api            # 463 tests / 52 suites
pnpm nx test web            # 108 tests / 17 suites
pnpm nx run-many -t typecheck -p api web web-e2e
pnpm nx lint web            # 85 errors is the accepted baseline — gate on "no new"
```

- **Never run `pkill`.** It has killed a whole session here. Stop a server by a
  PID confirmed with `lsof -ti :PORT`.
- Web app is **port 3002 only** (dev and start), API **2877**. Why 3002 and not
  anything else: currently the assigned port is 3002 and other are occupied by
  other applications in the server. Do not move it. Rishi browses the app in Brave
  while you work — **leave the dev server running** unless memory is genuinely
  red (`top -l 1 -n 0 | grep PhysMem`, `sysctl vm.swapusage`). The machine has
  8 GB and swaps hard.
- If `tsc` reports a wall of `TS6305 … has not been built from source file`,
  that is a stale composite build, not your change:
  `rm -rf apps/api/dist apps/api/out-tsc && npx tsc --build apps/api/tsconfig.json --emitDeclarationOnly --force`

## 6. Commit messages

Say what changed and **why it was wrong before**, in prose. Quote the document
row that drove it. If a test caught something you missed, say so. Do not write
"Refactor code structure for improved readability and maintainability" — a
commit that added the client's document folder was labelled exactly that, and
the message describes nothing that happened.

## 7. Open questions for Triple C — do not answer these yourself

- Animal code prefix: TDD row 7 and the Animal Register template say
  `PIG-YYYY-SEQ`; BBP §2.1 says `ANM-YYYY-NNNNN`.
- Does "weaning" mean the sow's event or the piglets' phase? On the BBP's chain
  (Sow → Piglet Lot → Weaner Batch) the weaner phase belongs to a batch.
- Residual value: a percentage (our column) or a per-kg rate (the Bio Asset BBP
  and the 20 Aug MOM)?
- Reporting currency: §1.1's flowchart says ZWL, its field spec says USD.
- ZWL or ZiG.
- 47 reason codes were promised; 3 exist. Mortality alone is specified as 21.
- The Kill Sheet and DOA have **no tables**. BBP gives the kill sheet a process
  (attached to the transfer order, carcass weights per line, invoice =
  Delivered Qty × Avg Carcass Weight × Price/KG) but no field specification.
