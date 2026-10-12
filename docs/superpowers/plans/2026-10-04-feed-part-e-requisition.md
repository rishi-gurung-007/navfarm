# Feed Part E — Common Requisition Screens, Two Feed Entry Points, One Approvals Inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approvals → Requisitions lists and creates every requisition type (Feed, Item, Fixed Asset, Service) as one header-and-lines document, drives the common document through Submit → Approve/Reject → Release → (Link PO | partial Shipment and Receipt), lets a feed requisition be created from either entry point through the same API, and shows both document kinds read-only in the one Approvals inbox.

**Architecture:** The API work closes the gaps that stop the existing common requisition (`apps/api/src/modules/procurement/requisition/`) from being a working document: list filter, edit-while-Open, display names and options, a Store release that actually creates its stock transfer, requisition-level shipment/receipt that write back to the requisition lines, and a ledger fix so a staged shipment and its receipt move the stock once. The feed document and API are reused as they are, plus the manual-line lifecycle check (Req. row 13) that Task 9 deliberately left out of `POST /feed-requisition`. The web work adds a presentational `CommonRequisitionDocument` built like `FeedRequisitionDocument` (FieldGroup header + ScrollTable lines), a `CommonRequisitionDetail` that owns the actions, a `FeedRequisitionDetail` extracted from the Feed Forecast tab so both entry points share it, and a `RequisitionsHub` that replaces the feed-only panel on `/approvals/requisitions`.

**Tech Stack:** NestJS 11, Drizzle ORM, MySQL 8, Jest; Next.js 16 / React 19, Testing Library; pnpm workspace (Nx targets are NOT trusted in this worktree — see Global Constraints).

**Spec:** `docs/superpowers/specs/2026-10-03-feed-tdd-alignment-and-inhouse-mill-design.md` §6a (Part E). Read with it: `docs/superpowers/specs/2026-10-01-feed-forecast-requisition-integration-design.md` ("Requisitions", "Common requisition", "Transfer execution", "UI structure"), `docs/decisions.md` entries of 2026-10-01 and 2026-10-03, and the field list of the 1 Oct plan `docs/superpowers/plans/2026-10-01-feed-forecast-requisition-integration.md` Task 8 "Interfaces".

---

## Global Constraints

Copied from `.superpowers/sdd/2026-10-03-feed-tdd-alignment/global-constraints.md` (binding items) and the Part A plan, plus this part's own.

- Work only in `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`, branch `feat/feed-forecast-requisition-integration`. Never push, merge, or touch the main checkout.
- Local databases only (`nf_devco`, `nf_system` on 127.0.0.1). Never the test server or `nf_portatestnavfarm`.
- New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`); `t()` falls back to English.
- Jest: always `--maxWorkers=2` (8 GB machine). Never `pkill`; stop a server by the PID from `lsof -ti :PORT`.
- **App must work at every commit (Rishi, 3 Oct):** commit only when `cd apps/api && npx tsc --noEmit -p tsconfig.app.json` reports 0 errors, `cd apps/web && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json` reports 0 errors when web changed, and the touched suites pass.
- **Web tests:** `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 <spec paths>` — never `pnpm nx test web` (nx replays the main checkout in this worktree and invented 5 phantom failures). API tests: `cd apps/api && npx jest <paths> --maxWorkers=2`.
- **Every nx target is suspect in this worktree** (`api:build`, `web:dev`, `test`, `lint`, `db-migrate-all-tenants`). Build the API with `cd apps/api && NODE_ENV=production NX_WORKSPACE_ROOT_PATH=/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration NX_TASK_TARGET_PROJECT=api NX_TASK_TARGET_TARGET=build ../../node_modules/.bin/webpack-cli build`, then **grep `dist/main.js` for a string from your newest commit** before trusting any answer. Serve the web with `cd apps/web && ../../node_modules/.bin/next dev --port 3002`. Migrate with the script's own command (Task 5) and read the result back from MySQL.
- **Schema changes additive only; no column drops.** Migration **0146 is RESERVED** for the deferred feed-era drop (post-merge). This plan owns **0147** only.
- Web lint gate: no new errors over the baseline measured at the start of Task 9 (`cd apps/web && ../../node_modules/.bin/eslint . 2>&1 | tail -1`); never "fix" exhaustive-deps.
- Use `Field`, `ReadField`, `FieldGroup`, `ScrollTable`, `ConsolePage`, `PageHeader` (apple.design.md §19). No one-off label/input markup.
- Never invent client data: no example names, codes or values in UI copy, seeds or fixtures beyond what tests need (test fixtures are labelled as such).
- Every field on the common document cites its source; fields with no document behind them are labelled **ours** in code comments (as `requisition.dto.ts` already does for `est_rate` and `description`).
- Commit messages: what changed and why it was wrong before, quote the decision/spec row, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage explicit paths, never `git add -A`.
- Business status stays independent of integration status. Purchase release records `BC_PENDING` and never claims a sync. Feed stops at Approved (no Release for FEED) until Part B.
- A manually created requisition may not be approved by its creator (decisions, 1 Oct). Only `source = 'AUTO_FORECAST'` drafts may be approved by the farm's own manager.

### Field sources for the common document (quoted, so no field is an invention)

| Field | Source |
|---|---|
| Number, date, main/farm location, requester snapshots, requester/sender department IDs, type, purpose, from/to sub-location, direct-transfer flag, remarks | 1 Oct plan Task 8 "Produces the supplied header fields: number/date, main/farm location, requester snapshots, requester/sender department IDs, type, purpose, from/to sub-location, direct-transfer flag and remarks." |
| Line requested, to-ship, shipped, to-receive, received, remaining-to-receive, balance-to-ship | 1 Oct plan Task 8 "Produces line snapshots plus requested, to-ship, shipped, to-receive, received, remaining-to-receive and balance-to-ship quantities." |
| Type Item / Fixed Asset / Service; Store only on Item; FA and Service use Purchase | decisions.md 2026-10-01 "Store applies only to Item requisitions; Fixed Asset and Service use Purchase." |
| Approval / document / fulfilment+integration states | 1 Oct spec "Common requisition": approval `OPEN, PENDING_APPROVAL, APPROVED, REJECTED`; document `OPEN, APPROVED, RELEASED, CANCELLED`; fulfilment `NOT_APPLICABLE … RECEIVED`. |
| Required date | BBP §7.2 step 5 "proposed delivery date" (`required_date`, existing DTO). |
| Justification | BBP §17.1 / existing DTO (`justification`). |
| Approved by / at, released by / at, linked PO, linked transfer | §6a header view "approved by/at"; decisions 1 Oct "Purchase release … records BC_PENDING" and §7.2 step 7 PO number; Part B "requisition.linked_transfer_id". |
| Est. rate, line description | **ours** — `requisition.dto.ts` says so already; keep that label. |
| Locations offered (FARM, STORE, SHED, SILO) and departments offered (Cost Center type DEPARTMENT) | Department: decisions 1 Oct "Department is represented by a company Cost Center Master row of type DEPARTMENT". The location-type set is **ours**. |

### Interpretations this plan makes (documented, none invented)

1. **A staged shipment takes the stock out of the source; its receipt puts it into the destination.** 1 Oct spec "Transfer execution: Add shipment and receipt documents for append-only partial events"; 3 Oct spec Part B "TO Receipt … Posts received KG once to silo+item (cp. 46)". Today both events call `writeTransferEntries`, which writes BOTH legs, so a ship-then-receive moves the stock twice (Task 4).
2. **Store Release creates the stock transfer** the shipments draw against, one transfer per requisition, lines linked by `stock_transfer_line.requisition_line_id` (Task 5/6). 1 Oct decision: "Store release starts an internal transfer"; `releaseTransition` already moves Store to `TRANSFER_OPEN` but no transfer exists today.
3. **The lifecycle-required item of a manual feed line** is any item the forecast demands at that destination in the default draft window (Engine sources for that silo/store). An item outside that set needs an exception reason; a destination with no demand has no requirement. 3 Oct spec §6a: "A manual feed line's item is checked against the lifecycle-required item for that silo's sheds; a different item needs a recorded exception reason (Req. row 13)."

---

## Review Focus

1. **The creator approves their own common requisition through `POST /requisition/:id/approve`** — must be refused. Today `create()` never sets `source`, and `decide()` only refuses when `source === 'MANUAL_ENTRY'`, so the controller route lets a creator approve their own document (the inbox handler refuses it). Pinned in Task 1.
2. **Ship 6 of 10, then receive 4** — source down 6 once, destination up 4 once, requisition line shipped 6 / received 4, balance to ship 4, remaining to receive 6, fulfilment `PARTIALLY_RECEIVED`. Today the ledger would move 6+4 out and 6+4 in. Pinned in Tasks 4 and 7.
3. **A requisition rejected, reopened, edited and resubmitted** — the edit must be refused while `REJECTED` and accepted after Reopen; a second approval request is raised. Pinned in Task 2.
4. **A manual feed line ordering an item the lifecycle does not require** — refused without an exception reason from BOTH entry points (same API); accepted with one; the reason is shown on the document. Pinned in Task 8 (API) and Task 10 (dialog sends `exception_reason`).
5. **A Store requisition whose line has its own from/to different from the header** — Release must refuse rather than create a transfer that silently ignores the line's locations. Pinned in Task 6.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/api/src/modules/procurement/requisition/requisition.rules.ts` (+ `.spec.ts`) | `isSelfApproval`, `assertEditable`, `transferPlanFor`, `mapToTransferLines`, `fulfilmentStatusOf`, `COMMON_LIST_DOC_TYPES` | modify |
| `apps/api/src/modules/procurement/requisition/requisition.service.ts` (+ `.service.spec.ts`, `.release.spec.ts`) | list filter, manual source, approved_by/at, update, options, display names, Store release → transfer, shipment/receipt | modify |
| `apps/api/src/modules/procurement/requisition/requisition.controller.ts` | `GET options`, `PUT :id`, `POST :id/shipment`, `POST :id/receipt`, `doc_type` query | modify |
| `apps/api/src/modules/procurement/requisition/dto/requisition.dto.ts` | `UpdateRequisitionDto`, `RequisitionShipmentDto`, `RequisitionReceiptDto` | modify |
| `apps/api/src/modules/procurement/requisition/requisition.module.ts` | import `StockTransferModule` | modify |
| `apps/api/src/modules/procurement/requisition/requisition-fulfilment.ts` (+ `.spec.ts`) | `syncRequisitionFulfilment(db, transferId)` — plain function, called by StockTransferService after each event | create |
| `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts` (+ spec) | `writeTransferShipment`, `writeTransferReceipt`, `transferShipmentRate` | modify |
| `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts` (+ `transfer-execution.service.spec.ts`, `stock-transfer.service.spec.ts`) | one ledger leg per event; `requisition_line_id` on lines; fulfilment sync | modify |
| `apps/api/src/modules/inventory/stock-transfer/dto/stock-transfer.dto.ts` | `StockTransferLineInput.requisition_line_id?` | modify |
| `apps/api/src/drizzle/tenant/0147_stock_transfer_line_requisition_line.sql`, `meta/_journal.json`, `part-e-migrations.spec.ts` | additive column + FK + index | create/modify |
| `apps/api/src/core/database/schema.ts` | `stockTransferLine.requisition_line_id` | modify |
| `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (+ spec), `.service.ts` (+ spec), `dto/feed-requisition.dto.ts` | manual line `exception_reason`, `requiredItemForManualLine`, check at create | modify |
| `apps/web/src/components/console/requisitions/common-requisition-model.ts` | types, `emptyCommonRequisition`, `toRequisitionPayload`, `isCommonEditable`, `commonActions` | create |
| `apps/web/src/components/console/requisitions/common-requisition-document.tsx` | presentational header form + lines sub-form | create |
| `apps/web/src/components/console/requisitions/common-requisition-detail.tsx` | Save / Submit / Reopen / Release / Link PO / Ship / Receive | create |
| `apps/web/src/components/console/requisitions/requisitions-hub.tsx` | Approvals → Requisitions: all types, filters, New, open by `?id=` | create |
| `apps/web/src/components/console/inventory/feed-requisition-detail.tsx` | feed document + Save/Submit, shared by both entry points | create (extracted from `requisitions-panel.tsx`) |
| `apps/web/src/components/console/inventory/requisitions-panel.tsx` | Feed Forecast tab list; uses `FeedRequisitionDetail` | modify |
| `apps/web/src/components/console/inventory/requisition-new-dialog.tsx` | type chooser Feed/Item/FA/Service, Store/Purchase, farm select, exception reason | modify |
| `apps/web/src/components/console/inventory/requisition-labels.ts` | labels for doc types, purposes, the three states | modify |
| `apps/web/src/app/(app)/approvals/requisitions/page.tsx` | render `RequisitionsHub` | modify |
| `apps/web/src/components/console/approvals/feed-requisition-approval-detail.tsx`, `requisition-approval-detail.tsx` | render the documents read-only | modify |
| `apps/web/src/utils/translations.ts` | `en` keys | modify |
| `apps/web/specs/*.spec.ts(x)` | new and updated specs (named per task) | create/modify |
| `docs/VERIFICATION-<date>-feed-part-e.md`, `AGENTS.md` §8 | evidence, state | create/modify |

---

### Task 1: Common list filter, manual source, approver stamp, one self-approval rule

**Files:**
- Modify: `apps/api/src/modules/procurement/requisition/requisition.rules.ts`
- Modify: `apps/api/src/modules/procurement/requisition/requisition.service.ts` (`create` ~line 166, `findAll` ~293, `decide` ~362, `decideFromApproval` ~545)
- Modify: `apps/api/src/modules/procurement/requisition/requisition.controller.ts` (`findAll`)
- Test: `apps/api/src/modules/procurement/requisition/requisition.rules.spec.ts`, `requisition.service.spec.ts`

**Interfaces:**
- Produces: `isSelfApproval(row: { source: string | null; created_by: string | null; requester_user_id: string | null }, userId: string | undefined): boolean`; `COMMON_LIST_DOC_TYPES = ['FEED', 'ITEM', 'FA', 'SERVICE'] as const`.
- Produces: `GET /requisition?doc_type=ITEM|FA|SERVICE|FEED` (400 for anything else); list rows add `purpose`, `source`.
- Produces: common rows written by `create` carry `source: 'MANUAL_ENTRY'`; an approval writes `approved_by` and `approved_at`.

- [ ] **Step 1: Write the failing rules test** (append to `requisition.rules.spec.ts`; add `isSelfApproval` to its import from `./requisition.rules`)

```ts
describe('isSelfApproval — decisions 1 Oct: nobody approves a manual requisition they created', () => {
  const row = (over: Partial<{ source: string | null; created_by: string | null; requester_user_id: string | null }> = {}) => ({
    source: 'MANUAL_ENTRY', created_by: 'u1', requester_user_id: 'u1', ...over,
  });
  it('flags the creator on a manual document', () => {
    expect(isSelfApproval(row(), 'u1')).toBe(true);
  });
  it('flags the creator when source was never written (legacy common rows)', () => {
    expect(isSelfApproval(row({ source: null }), 'u1')).toBe(true);
  });
  it('flags the recorded requester even if someone else keyed it', () => {
    expect(isSelfApproval(row({ created_by: 'u9' }), 'u1')).toBe(true);
  });
  it('lets the farm manager approve a system forecast draft', () => {
    expect(isSelfApproval(row({ source: 'AUTO_FORECAST' }), 'u1')).toBe(false);
  });
  it('lets a different user approve', () => {
    expect(isSelfApproval(row(), 'u2')).toBe(false);
  });
  it('has nothing to compare without a user', () => {
    expect(isSelfApproval(row(), undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/api && npx jest src/modules/procurement/requisition/requisition.rules.spec.ts --maxWorkers=2`
Expected: FAIL — `isSelfApproval is not a function` (TS: has no exported member).

- [ ] **Step 3: Implement the rule** (append to `requisition.rules.ts`)

```ts
/** Every doc_type the common list may be filtered by — FEED included, it is one document (spec §6a). */
export const COMMON_LIST_DOC_TYPES = ['FEED', 'ITEM', 'FA', 'SERVICE'] as const;

/**
 * decisions.md 2026-10-01: "A user must not approve a manually created
 * requisition that they created. System-generated feed drafts may be reviewed
 * and approved by the Farm Manager for that farm." Only AUTO_FORECAST is
 * system-generated; anything else — MANUAL_ENTRY, and a legacy common row with
 * no source at all — is manual.
 */
export function isSelfApproval(
  row: { source: string | null; created_by: string | null; requester_user_id: string | null },
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  if (row.source === 'AUTO_FORECAST') return false;
  return row.created_by === userId || row.requester_user_id === userId;
}
```

- [ ] **Step 4: Run the rules test** — same command. Expected: PASS.

- [ ] **Step 5: Write the failing service tests** (append to `requisition.service.spec.ts`; add `import * as schema from '../../../core/database/schema';` if not present)

```ts
describe('Part E Task 1 — list filter, manual source, approver stamp', () => {
  it('stamps a common draft MANUAL_ENTRY so the controller approve route sees it as manual', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada Farm', department_id: null }], // requesting user
      [],                                              // number series
      [headerRow({ source: 'MANUAL_ENTRY' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values.source).toBe('MANUAL_ENTRY');
  });

  it('refuses the creator on POST /requisition/:id/approve even when source was never written', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', source: null })]);
    const approvals = approvalsMock();
    const service = new RequisitionService(transactionCls(db), approvals as any);
    jest.spyOn(require('../../../common/permissions'), 'userHasPermission').mockResolvedValue(true);
    await expect(service.decide('req-1', {}, 'APPROVED', TENANT, { userId: 'u1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow('You may not approve a requisition you created. Another authorized approver must decide it.');
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('writes approved_by and approved_at with the decision', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push(
      [headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', source: 'MANUAL_ENTRY' })], // locked row
      [headerRow({ status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' })],                                       // findOne header
      [lineRow()],                                                                                                                           // findOne lines
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    jest.spyOn(require('../../../common/permissions'), 'userHasPermission').mockResolvedValue(true);
    await service.decide('req-1', {}, 'APPROVED', TENANT, { userId: 'u2', userType: 'COMPANY_ADMIN' });
    expect(setCalls[0]).toMatchObject({ status: 'APPROVED', approved_by: 'u2' });
    expect(String(setCalls[0].approved_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('refuses an unknown doc_type filter before any query', async () => {
    const { db } = makeDb();
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await expect(service.findAll({ doc_type: 'PIGS' }, TENANT)).rejects.toThrow('doc_type must be one of FEED, ITEM, FA, SERVICE.');
    expect(db.select).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run** `cd apps/api && npx jest src/modules/procurement/requisition/requisition.service.spec.ts --maxWorkers=2`. Expected: the four new tests FAIL (source undefined; creator approved; no approved_by; filter ignored).

- [ ] **Step 7: Implement in `requisition.service.ts`**

In the imports from `./requisition.rules` add `COMMON_LIST_DOC_TYPES, isSelfApproval`.

In `create()`'s `insert(schema.requisition).values({...})` add, after `purpose,`:

```ts
        // decisions 1 Oct: a common draft is keyed by a person, so it is manual —
        // the self-approval rule keys on this (isSelfApproval).
        source: 'MANUAL_ENTRY',
```

Replace the self-approval block in `decide()` (the `if (decision === 'APPROVED' && userPayload?.userId && row.source === 'MANUAL_ENTRY' && …)`) with:

```ts
      if (decision === 'APPROVED' && isSelfApproval(row, userPayload?.userId)) {
        throw new ForbiddenException('You may not approve a requisition you created. Another authorized approver must decide it.');
      }
```

and the same in `decideFromApproval()` (replace its `row.source !== 'AUTO_FORECAST' && …` block with the identical `isSelfApproval(row, userPayload?.userId)` check).

In both `decide()`'s and `decideFromApproval()`'s `.set({...})` add:

```ts
          // §6a header view "approved by/at" (Req. rows 37–38 on the feed side).
          approved_by: decision === 'APPROVED' ? (userPayload?.userId ?? null) : null,
          approved_at: decision === 'APPROVED' ? nowTs() : null,
```

Change `findAll`'s signature and add the filter and two columns:

```ts
  async findAll(query: { company_id?: string; status?: string; doc_type?: string }, tenantId: string) {
    if (query.doc_type && !(COMMON_LIST_DOC_TYPES as readonly string[]).includes(query.doc_type)) {
      throw new BadRequestException(`doc_type must be one of ${COMMON_LIST_DOC_TYPES.join(', ')}.`);
    }
    // …existing conditions…
    if (query.doc_type) conditions.push(eq(schema.requisition.doc_type, query.doc_type));
```

and in its `select({...})` add `purpose: schema.requisition.purpose, source: schema.requisition.source,`.

In `requisition.controller.ts` `findAll`:

```ts
  async findAll(@Req() req: any, @Query('company_id') companyId?: string, @Query('status') status?: string, @Query('doc_type') docType?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.findAll({ company_id: companyId, status, doc_type: docType }, tenantId);
```

- [ ] **Step 8: Run both suites and the typecheck**

Run: `cd apps/api && npx jest src/modules/procurement/requisition --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json`
Expected: all PASS, 0 TS errors. If an older test asserted that a creator could approve when `source` was null, it encoded the defect — change it to expect the refusal and say so in the commit.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/procurement/requisition/requisition.rules.ts apps/api/src/modules/procurement/requisition/requisition.rules.spec.ts apps/api/src/modules/procurement/requisition/requisition.service.ts apps/api/src/modules/procurement/requisition/requisition.service.spec.ts apps/api/src/modules/procurement/requisition/requisition.controller.ts
git commit -m "fix(requisition): a creator could approve their own common requisition through the API

create() never wrote source, and decide() refused self-approval only when
source was MANUAL_ENTRY, so POST /requisition/:id/approve let the creator
approve (the inbox handler already refused). One rule now, isSelfApproval:
anything not AUTO_FORECAST is manual (decisions 2026-10-01). Common drafts
are stamped MANUAL_ENTRY; an approval writes approved_by/approved_at (spec
§6a header view); GET /requisition takes a doc_type filter so Approvals ->
Requisitions can list every type (spec §6a).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Edit an Open common requisition — `PUT /requisition/:id`

**Files:**
- Modify: `apps/api/src/modules/procurement/requisition/requisition.rules.ts`, `dto/requisition.dto.ts`, `requisition.service.ts`, `requisition.controller.ts`
- Test: `requisition.rules.spec.ts`, `requisition.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`source` stamped).
- Produces: `assertEditable(row: { req_no: string; doc_type: string; status?: string | null; approval_status?: string | null; document_status?: string | null }): void`.
- Produces: `UpdateRequisitionDto` = `CreateRequisitionDto` without `company_id`; `PUT /requisition/:id` (permission `PROCUREMENT/REQUISITION/create`) replaces header fields and **all** lines, returns `findOne`.
- Produces: private `lineValues(requisitionId, purpose, lines, header: { from_location_id?: string | null; to_location_id?: string | null })` used by `create` and `update`.

- [ ] **Step 1: Failing rules test** (append; import `assertEditable`)

```ts
describe('assertEditable — "editable while the document is open" (spec §6a)', () => {
  const row = (over: Record<string, string | null> = {}) => ({ req_no: 'REQ-2026-0001', doc_type: 'ITEM', status: 'DRAFT', approval_status: 'OPEN', document_status: 'OPEN', ...over });
  it('accepts an Open draft', () => expect(() => assertEditable(row())).not.toThrow());
  it('accepts a legacy DRAFT row with null states (projected Open)', () =>
    expect(() => assertEditable(row({ approval_status: null, document_status: null }))).not.toThrow());
  it.each([
    ['pending', { status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL' }],
    ['approved', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' }],
    ['rejected (reopen first)', { status: 'REJECTED', approval_status: 'REJECTED', document_status: 'OPEN' }],
    ['released', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED' }],
  ])('refuses a %s document', (_n, over) => {
    expect(() => assertEditable(row(over))).toThrow('Requisition REQ-2026-0001 can no longer be edited; only an Open requisition can change.');
  });
  it('sends a feed document to its own editor', () => {
    expect(() => assertEditable(row({ doc_type: 'FEED' }))).toThrow('A feed requisition is edited from its own document (PUT /feed-requisition/:id).');
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && npx jest src/modules/procurement/requisition/requisition.rules.spec.ts --maxWorkers=2` → FAIL (not exported).

- [ ] **Step 3: Implement** (append to `requisition.rules.ts`)

```ts
/**
 * Spec §6a: the lines grid is "editable while the document is open". Open
 * means approval OPEN and document OPEN; a REJECTED document is corrected only
 * after Reopen (decisions 1 Oct: "Rejected documents return to Open for
 * correction"), which is an explicit action, not an edit.
 */
export function assertEditable(row: { req_no: string; doc_type: string; status?: string | null; approval_status?: string | null; document_status?: string | null }): void {
  if (row.doc_type === 'FEED') {
    throw new BadRequestException('A feed requisition is edited from its own document (PUT /feed-requisition/:id).');
  }
  const states = projectRequisitionStates(row);
  if (states.approval_status !== 'OPEN' || states.document_status !== 'OPEN') {
    throw new BadRequestException(`Requisition ${row.req_no} can no longer be edited; only an Open requisition can change.`);
  }
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Failing service test** (append to `requisition.service.spec.ts`)

```ts
describe('Part E Task 2 — PUT /requisition/:id', () => {
  it('replaces the header fields and every line of an Open draft', async () => {
    const { db, selectResults, setCalls, insertValues } = makeDb();
    selectResults.push(
      [headerRow()],          // the locked row
      [headerRow({ remarks: 'Changed' })], // findOne header
      [lineRow({ quantity: '4.0000' })],   // findOne lines
    );
    db.delete = jest.fn(() => ({ where: jest.fn(async () => undefined) }));
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    const result = await service.update('req-1', {
      doc_type: 'ITEM', purpose: 'PURCHASE', remarks: 'Changed',
      lines: [{ item_id: 'item-1', quantity: 4, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' });
    expect(setCalls[0]).toMatchObject({ purpose: 'PURCHASE', remarks: 'Changed', from_location_id: null, to_location_id: null, updated_by: 'u1' });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(insertValues[0].values[0]).toMatchObject({ line_seq: 1, quantity: '4', qty_to_ship: null, qty_to_receive: null });
    expect(result.remarks).toBe('Changed');
  });

  it('refuses a submitted document before writing anything', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push([headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL' })]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await expect(service.update('req-1', { purpose: 'STORE', from_location_id: 'a', to_location_id: 'b', lines: [{ item_id: 'i', quantity: 1, uom: 'EA' }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('can no longer be edited');
    expect(setCalls).toHaveLength(0);
  });

  it('refuses a change of document type', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow()]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await expect(service.update('req-1', { doc_type: 'FA', purpose: 'PURCHASE', lines: [{ description: 'Pump', quantity: 1, uom: 'EA' }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('The document type cannot change; create a new requisition instead.');
  });
});
```

(`headerRow()` in the spec has `from_location_id: null`; the PURCHASE edit therefore clears locations, which is what a Purchase document carries.)

- [ ] **Step 6: Run** → FAIL (`service.update is not a function`).

- [ ] **Step 7: Implement**

`dto/requisition.dto.ts` — add at the bottom:

```ts
import { OmitType } from '@nestjs/swagger';

/** PUT /requisition/:id — the whole document while it is Open; lines are replaced, not merged. */
export class UpdateRequisitionDto extends OmitType(CreateRequisitionDto, ['company_id'] as const) {}
```

(Move the `OmitType` import to the existing `@nestjs/swagger` import line.)

`requisition.service.ts` — extract the line mapping from `create()` into a private method and call it from both:

```ts
  /** One insert row per supplied line — the mapping create() always used, shared with update(). */
  private lineValues(
    requisitionId: string,
    purpose: RequisitionPurpose,
    lines: CreateRequisitionDto['lines'],
    header: { from_location_id?: string | null; to_location_id?: string | null },
  ) {
    return lines.map((line, index) => {
      const balances = lineBalances(line);
      return {
        requisition_id: requisitionId,
        line_seq: index + 1,
        item_id: line.item_id ?? null,
        resource_id: line.resource_id ?? null,
        description: line.description ?? null,
        quantity: String(line.quantity),
        uom: line.uom,
        est_rate: line.est_rate !== undefined && line.est_rate !== null ? String(line.est_rate) : null,
        from_location_id: line.from_location_id ?? header.from_location_id ?? null,
        to_location_id: line.to_location_id ?? header.to_location_id ?? null,
        qty_to_ship: purpose === 'STORE' ? String(balances.qty_to_ship) : null,
        qty_to_receive: purpose === 'STORE' ? String(balances.qty_to_receive) : null,
        qty_shipped: null,
        qty_received: null,
      };
    });
  }
```

(import `type RequisitionPurpose` from the rules; in `create()` replace the inline `dto.lines.map(...)` with `this.lineValues(requisitionId, purpose, dto.lines, dto)`.)

Add `update()`:

```ts
  /** Spec §6a: header and lines are editable while the document is Open. */
  async update(requisitionId: string, dto: UpdateRequisitionDto, tenantId: string, userPayload?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const [row] = await this.db
        .select()
        .from(schema.requisition)
        .where(and(
          eq(schema.requisition.requisition_id, requisitionId),
          eq(schema.requisition.tenant_id, tenantId),
          isNull(schema.requisition.deleted_at),
          ...this.scopeConditions(),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
      assertEditable(row);
      if (dto.doc_type && dto.doc_type !== row.doc_type) {
        throw new BadRequestException('The document type cannot change; create a new requisition instead.');
      }
      const docType = normalizeCommonDocType(row.doc_type);
      const purpose = assertPurpose(docType, dto.purpose ?? row.purpose);
      assertRequisitionLines(docType, purpose, dto.lines);
      const fromLocationId = purpose === 'STORE' ? (dto.from_location_id ?? null) : null;
      const toLocationId = purpose === 'STORE' ? (dto.to_location_id ?? null) : null;
      assertPurposeLocations(purpose, fromLocationId, toLocationId);
      const directTransfer = Boolean(dto.direct_transfer);
      if (directTransfer) assertDirectTransferEligible({ docType, purpose, fromLocationId, toLocationId });
      for (const [id, label] of [[dto.requester_department_id, 'Requester department'], [dto.sender_department_id, 'Sender department']] as const) {
        if (id) await assertDepartmentIdentity(this.db, { tenantId, companyId: row.company_id, departmentId: id, label });
      }
      const scope = farmScope(this.cls);
      for (const [id, label] of [[dto.main_location_id, 'Requisition main location'], [fromLocationId, 'Requisition source location'], [toLocationId, 'Requisition destination location']] as const) {
        if (id) await assertLocationOnActiveFarm(this.db, scope, id, label);
      }
      await this.db
        .update(schema.requisition)
        .set({
          purpose,
          requisition_date: dto.requisition_date ?? row.requisition_date,
          main_location_id: dto.main_location_id ?? row.main_location_id,
          requester_department_id: dto.requester_department_id ?? row.requester_department_id,
          sender_department_id: dto.sender_department_id ?? null,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          direct_transfer: directTransfer,
          remarks: dto.remarks ?? null,
          required_date: dto.required_date ?? null,
          justification: dto.justification ?? null,
          updated_by: userPayload?.userId ?? null,
        })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      await this.db.delete(schema.requisitionLine).where(eq(schema.requisitionLine.requisition_id, requisitionId));
      await this.db.insert(schema.requisitionLine).values(
        this.lineValues(requisitionId, purpose, dto.lines, { from_location_id: fromLocationId, to_location_id: toLocationId }),
      );
      return this.findOne(requisitionId, tenantId);
    });
  }
```

(Import `assertEditable` from the rules and `UpdateRequisitionDto` from the DTO.)

`requisition.controller.ts` — add (import `Put` and `UpdateRequisitionDto`):

```ts
  @Put(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Edit an Open requisition — header fields and all lines (spec §6a)' })
  @ApiParam({ name: 'id' })
  async update(@Param('id') id: string, @Body() dto: UpdateRequisitionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Requisition saved.', data };
  }
```

- [ ] **Step 8: Run** `cd apps/api && npx jest src/modules/procurement/requisition --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json` → PASS, 0 errors.

- [ ] **Step 9: Commit** — `feat(requisition): edit an Open common requisition — PUT /requisition/:id` with body explaining there was no edit endpoint at all, so a draft could only be thrown away; quote spec §6a "Lines grid below it, editable while the document is open" and decisions 1 Oct "Rejected documents return to Open for correction". Stage the five files explicitly.

---

### Task 3: Options for the form and display names on the document

**Files:**
- Modify: `apps/api/src/modules/procurement/requisition/requisition.service.ts` (`options`, `findOne`)
- Modify: `apps/api/src/modules/procurement/requisition/requisition.controller.ts`
- Test: `requisition.service.spec.ts`

**Interfaces:**
- Produces: `GET /requisition/options?company_id=<uuid>&farm_id=<uuid?>` (permission `PROCUREMENT/REQUISITION/view`, declared **before** `@Get(':id')`) →
  `{ items: {item_id,item_code,item_name,uom_primary}[]; resources: {resource_id,resource_code,resource_name}[]; locations: {location_id,location_code,location_name,location_type,farm_id}[]; departments: {cost_center_id,cost_center_code,cost_center_name}[] }`.
- Produces: `findOne` adds header `main_location_code`, `from_location_code`, `to_location_code`, `requester_department_name`, `sender_department_name`, `approved_by_name`, `released_by_name`, `linked_transfer_no`; each line adds `resource_code`, `resource_name`, `from_location_code`, `to_location_code`. Shape stays additive; the new reads run **after** the existing two selects so earlier specs' queues are untouched.

Why an options endpoint: the common form needs items, resources, locations and departments. The Master Data routes answer with tenant templates in a tenant-wide workspace and refuse a farm login (the F3 / review I3 finding that produced `GET /feed-requisition/options`). Same reason, same cure.

- [ ] **Step 1: Failing test**

```ts
describe('Part E Task 3 — options and display names', () => {
  it('offers the company items, resources, FARM/STORE/SHED/SILO locations and DEPARTMENT cost centres', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [{ item_id: 'i1', item_code: 'IT-1', item_name: 'Bolts', uom_primary: 'EA' }],
      [{ resource_id: 'r1', resource_code: 'RES-1', resource_name: 'Electrician' }],
      [{ location_id: 'st', location_code: 'F1/STORE', location_name: 'Store', location_type: 'STORE', farm_id: 'f1' }],
      [{ cost_center_id: 'cc', cost_center_code: 'D-1', cost_center_name: 'Stores' }],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    const out = await service.options({ company_id: 'co-1' }, TENANT);
    expect(out.items.map((i) => i.item_code)).toEqual(['IT-1']);
    expect(out.resources.map((r) => r.resource_code)).toEqual(['RES-1']);
    expect(out.locations.map((l) => l.location_type)).toEqual(['STORE']);
    expect(out.departments.map((d) => d.cost_center_code)).toEqual(['D-1']);
  });

  it('names the locations, departments, approver and transfer on the document', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({ from_location_id: 'st', to_location_id: 'sh', sender_department_id: 'cc', approved_by: 'u2', linked_transfer_id: 'tr-1' })],
      [lineRow({ from_location_id: 'st', to_location_id: 'sh', resource_id: null })],
      [{ location_id: 'st', location_code: 'F1/STORE' }, { location_id: 'sh', location_code: 'F1/SHED-1' }, { location_id: 'farm-1', location_code: 'F1' }],
      [{ cost_center_id: 'cc', cost_center_name: 'Stores' }],
      [{ user_id: 'u2', full_name: 'Approver Two' }],
      [{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }],
      [], // resources
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    const view = await service.findOne('req-1', TENANT);
    expect(view).toMatchObject({ from_location_code: 'F1/STORE', to_location_code: 'F1/SHED-1', main_location_code: 'F1', sender_department_name: 'Stores', approved_by_name: 'Approver Two', linked_transfer_no: 'TR-000001' });
    expect(view.lines[0]).toMatchObject({ from_location_code: 'F1/STORE', to_location_code: 'F1/SHED-1' });
  });
});
```

(The fixture names above are test fixtures, not client data.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
  /** Location types a common requisition may move between — ours (no document lists them). */
  private static readonly REQUISITION_LOCATION_TYPES = ['FARM', 'STORE', 'SHED', 'SILO'];

  async options(query: { company_id: string; farm_id?: string }, tenantId: string) {
    assertCompanyInScope(farmScope(this.cls), query.company_id);
    const scopeFarm = farmScope(this.cls).farmId ?? query.farm_id ?? null;
    const items = await this.db
      .select({ item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name, uom_primary: schema.itemMaster.uom_primary })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.company_id, query.company_id), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
      .orderBy(schema.itemMaster.item_code);
    const resources = await this.db
      .select({ resource_id: schema.resourceMaster.resource_id, resource_code: schema.resourceMaster.resource_code, resource_name: schema.resourceMaster.resource_name })
      .from(schema.resourceMaster)
      .where(and(eq(schema.resourceMaster.tenant_id, tenantId), eq(schema.resourceMaster.company_id, query.company_id), isNull(schema.resourceMaster.deleted_at)))
      .orderBy(schema.resourceMaster.resource_code);
    const locationConditions: SQL[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, query.company_id),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      inArray(schema.locationMaster.location_type, RequisitionService.REQUISITION_LOCATION_TYPES),
    ];
    if (scopeFarm) locationConditions.push(or(eq(schema.locationMaster.farm_id, scopeFarm), eq(schema.locationMaster.location_id, scopeFarm))!);
    const locations = await this.db
      .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name, location_type: schema.locationMaster.location_type, farm_id: schema.locationMaster.farm_id })
      .from(schema.locationMaster)
      .where(and(...locationConditions))
      .orderBy(schema.locationMaster.location_code);
    const departments = await this.db
      .select({ cost_center_id: schema.costCenterMaster.cost_center_id, cost_center_code: schema.costCenterMaster.cost_center_code, cost_center_name: schema.costCenterMaster.cost_center_name })
      .from(schema.costCenterMaster)
      .where(and(eq(schema.costCenterMaster.tenant_id, tenantId), eq(schema.costCenterMaster.company_id, query.company_id), eq(schema.costCenterMaster.cost_center_type, DEPARTMENT_COST_CENTER_TYPE), eq(schema.costCenterMaster.is_active, true)))
      .orderBy(schema.costCenterMaster.cost_center_code);
    return { items, resources, locations, departments };
  }
```

(Check the column names before use: `grep -n "is_active\|deleted_at" apps/api/src/core/database/schema.ts` near `resourceMaster` (line ~1588) — if `resource_master` has no `deleted_at`, drop that condition; do not invent one. Import `inArray`, `or` from drizzle-orm and `DEPARTMENT_COST_CENTER_TYPE` from `../../../common/department-identity`.)

At the end of `findOne`, before `return`, add the name reads (each a single `inArray` read; empty id lists skip the query):

```ts
    const ids = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => !!v))];
    const locationIds = ids([row.main_location_id, row.from_location_id, row.to_location_id, ...lines.flatMap((l) => [l.from_location_id, l.to_location_id])]);
    const locationCode = new Map((locationIds.length
      ? await this.db.select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds))
      : []).map((l) => [l.location_id, l.location_code]));
    const departmentIds = ids([row.requester_department_id, row.sender_department_id]);
    const departmentName = new Map((departmentIds.length
      ? await this.db.select({ cost_center_id: schema.costCenterMaster.cost_center_id, cost_center_name: schema.costCenterMaster.cost_center_name })
        .from(schema.costCenterMaster).where(inArray(schema.costCenterMaster.cost_center_id, departmentIds))
      : []).map((d) => [d.cost_center_id, d.cost_center_name]));
    const userIds = ids([row.approved_by, row.released_by]);
    const userName = new Map((userIds.length
      ? await this.db.select({ user_id: schema.userMaster.user_id, full_name: schema.userMaster.full_name })
        .from(schema.userMaster).where(inArray(schema.userMaster.user_id, userIds))
      : []).map((u) => [u.user_id, u.full_name]));
    const [transfer] = row.linked_transfer_id
      ? await this.db.select({ transfer_id: schema.stockTransfer.transfer_id, transfer_no: schema.stockTransfer.transfer_no })
        .from(schema.stockTransfer).where(eq(schema.stockTransfer.transfer_id, row.linked_transfer_id)).limit(1)
      : [];
    const resourceIds = ids(lines.map((l) => l.resource_id));
    const resource = new Map((resourceIds.length
      ? await this.db.select({ resource_id: schema.resourceMaster.resource_id, resource_code: schema.resourceMaster.resource_code, resource_name: schema.resourceMaster.resource_name })
        .from(schema.resourceMaster).where(inArray(schema.resourceMaster.resource_id, resourceIds))
      : []).map((r) => [r.resource_id, r]));
```

and spread the names into the returned header (`main_location_code: locationCode.get(row.main_location_id ?? '') ?? null`, `from_location_code`, `to_location_code`, `requester_department_name`, `sender_department_name`, `approved_by_name: userName.get(row.approved_by ?? '') ?? null`, `released_by_name`, `linked_transfer_no: transfer?.transfer_no ?? null`) and each line (`from_location_code`, `to_location_code`, `resource_code: resource.get(line.resource_id ?? '')?.resource_code ?? null`, `resource_name`). The spec's mock returns rows in call order: keep the order locations → departments → users → transfer → resources exactly as the test lists it.

Controller (import `Query` already there), **above** `@Get(':id')`:

```ts
  @Get('options')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: 'What the common requisition form may offer: items, resources, locations, departments' })
  async options(@Req() req: any, @Query('company_id') companyId: string, @Query('farm_id') farmId?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    if (!companyId) throw new BadRequestException('company_id is required.');
    const data = await this.requisitions.options({ company_id: companyId, farm_id: farmId }, tenantId);
    return { success: true, message: 'Requisition options retrieved.', data };
  }
```

- [ ] **Step 4: Run** `cd apps/api && npx jest src/modules/procurement/requisition --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json` → PASS, 0 errors.

- [ ] **Step 5: Commit** — `feat(requisition): options and display names for the common document` (body: the document showed raw UUIDs for locations and departments and had no way to list what a line may name without Master Data grants — the F3/I3 problem the feed options endpoint already solved; the location-type set is ours).

---

### Task 4: A staged transfer moves the stock once — shipment out of the source, receipt into the destination

**Files:**
- Modify: `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts` (beside `writeTransferEntries`, line ~421)
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts` (`postShipment` ~456, `postReceipt` ~538)
- Test: `apps/api/src/modules/inventory/stock-transfer/transfer-execution.service.spec.ts`, `stock-transfer.service.spec.ts`, `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.spec.ts`

**Interfaces:**
- Produces on `InventoryLedgerService`:
  - `writeTransferShipment(p: { tenantId; companyId; itemId; documentNo; documentLineId; postingDate; quantity; uom; fromWarehouseId; lotNo?; serialNo?; userId? }): Promise<InventoryLedgerRow>` — one `TRANSFER_SHIPMENT` negative entry at the source.
  - `transferShipmentRate(p: { tenantId: string; shipmentNo: string; lineId: string }): Promise<number>` — |Σamount| ÷ |Σquantity| of that shipment line's `TRANSFER_SHIPMENT` rows; throws `BadRequestException('Shipment <no> has no posted ledger entry for this line.')` when none.
  - `writeTransferReceipt(p: { tenantId; companyId; itemId; documentNo; documentLineId; postingDate; quantity; uom; toWarehouseId; rate: number; lotNo?; serialNo?; userId? }): Promise<InventoryLedgerRow>` — one `TRANSFER_RECEIPT` positive entry at the destination.
- `writeTransferEntries` stays for nothing but `postOriginal_superseded` (dead code, untouched).

**Why (the defect):** `postShipment` calls `writeTransferEntries`, which writes the negative at the source **and** the positive at the destination; `postReceipt` calls it again for the same quantity. Ship 6 then receive 6 therefore takes 12 out and puts 12 in. `post()`/Direct Transfer runs both, so **every** stock transfer posted since `5c38c1eb` (1 Oct) would double. `nf_devco` has no `transfer_shipment` rows yet (checked 4 Oct: `select count(*) from transfer_shipment` → 0), so no data needs repair locally. The specs mock `writeTransferEntries`, which is why 580+ green tests never saw it.

- [ ] **Step 1: Reproduce before fixing (drive it, do not trust the reading).** Build and start the API from this worktree (Global Constraints build command; then `lsof -ti :2877` → `kill <pid>`; `cd apps/api && node --env-file-if-exists=.env dist/main.js &`). Log in as the seed COMPANY_ADMIN from `apps/api/src/scripts/seed-dev-tenant.ts` through `POST /api/v1/auth/login` (keep the token in a shell variable; do not paste credentials into any file). Pick a STORE with a positive non-feed balance:

```sql
select l.warehouse_id, lm.location_code, l.item_id, l.uom, sum(l.quantity) qty
from inventory_ledger l join location_master lm on lm.location_id = l.warehouse_id
where lm.location_type = 'STORE' group by 1,2,3,4 having qty > 1 limit 5;
```

Create a 1-unit draft (`POST /api/v1/stock-transfer` from that store to another location of the same company) and `POST /api/v1/stock-transfer/:id/post`. Then:

```sql
select transaction_type, warehouse_id, quantity, document_no from inventory_ledger
where document_type = 'STOCK_TRANSFER' and document_no regexp '^(SH|RC)-' order by created_at;
```

Expected (the defect): **four** rows — two `TRANSFER_SHIPMENT` −1 at the source and two `TRANSFER_RECEIPT` +1 at the destination. Record the output for the commit message. If you see two rows, stop and report: the reading was wrong and this task changes nothing.

- [ ] **Step 2: Failing service tests** — in `transfer-execution.service.spec.ts`, replace the ledger mock in `setup()` with:

```ts
const ledger = {
  writeTransferEntries: jest.fn(),
  writeTransferShipment: jest.fn().mockResolvedValue({ ledger_id: 'led-sh' }),
  writeTransferReceipt: jest.fn().mockResolvedValue({ ledger_id: 'led-rc' }),
  transferShipmentRate: jest.fn().mockResolvedValue(2.5),
};
```

(pass `ledger as unknown as InventoryLedgerService` and return `ledger` from `setup`), then add:

```ts
describe('Part E Task 4 — one ledger leg per event (cp. 46: received KG posted once)', () => {
  it('a shipment takes the quantity out of the source only', async () => {
    const { service, as, ledger } = setup(baseQueues());
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 6 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferEntries).not.toHaveBeenCalled();
    expect(ledger.writeTransferReceipt).not.toHaveBeenCalled();
    expect(ledger.writeTransferShipment).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferShipment).toHaveBeenCalledWith(expect.objectContaining({ fromWarehouseId: 'wh-store', quantity: 6, documentLineId: 'line-1', lotNo: 'LOT-9' }));
  });

  it('a receipt puts the quantity into the destination only, at the shipment rate', async () => {
    const queues = baseQueues();
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceiptLine, [[]]);
    const { service, as, ledger } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferEntries).not.toHaveBeenCalled();
    expect(ledger.writeTransferShipment).not.toHaveBeenCalled();
    expect(ledger.transferShipmentRate).toHaveBeenCalledWith({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1' });
    expect(ledger.writeTransferReceipt).toHaveBeenCalledWith(expect.objectContaining({ toWarehouseId: 'wh-farm', quantity: 4, rate: 2.5, lotNo: 'LOT-9' }));
  });
});
```

Update the direct-transfer test in the same file and every `writeTransferEntries` mock in `stock-transfer.service.spec.ts` (lines ~118, ~152) to the same four-function `ledger` object, and change any assertion that counted `writeTransferEntries` calls to count one `writeTransferShipment` plus one `writeTransferReceipt` per line.

- [ ] **Step 3: Run** `cd apps/api && npx jest src/modules/inventory/stock-transfer --maxWorkers=2` → the two new tests FAIL (`writeTransferEntries` called).

- [ ] **Step 4: Implement the ledger methods** (in `inventory-ledger.service.ts`, after `writeTransferEntries`)

```ts
  /**
   * Part E Task 4: the shipment event's one ledger leg. Stock leaves the source
   * now and reaches the destination only when it is received (1 Oct spec
   * "Transfer execution"; 3 Oct spec Part B, cp. 46 "posts received KG once").
   */
  async writeTransferShipment(params: {
    tenantId: string; companyId: string; itemId: string; documentNo: string; documentLineId: string;
    postingDate: string; quantity: number; uom: string; fromWarehouseId: string;
    lotNo?: string; serialNo?: string; userId?: string;
  }) {
    return this.writeNegativeEntry({
      tenantId: params.tenantId, companyId: params.companyId, itemId: params.itemId,
      documentType: 'STOCK_TRANSFER', documentNo: params.documentNo, documentLineId: params.documentLineId,
      postingDate: params.postingDate, transactionType: 'TRANSFER_SHIPMENT', quantity: params.quantity, uom: params.uom,
      lotNo: params.lotNo, serialNo: params.serialNo, warehouseId: params.fromWarehouseId, userId: params.userId,
    });
  }

  /** The unit cost the shipment carried out of the source, so the receipt values the stock the same. */
  async transferShipmentRate(params: { tenantId: string; shipmentNo: string; lineId: string }): Promise<number> {
    const [row] = await this.db
      .select({
        amount: sql<string>`COALESCE(SUM(${schema.inventoryLedger.amount}), 0)`,
        qty: sql<string>`COALESCE(SUM(${schema.inventoryLedger.quantity}), 0)`,
      })
      .from(schema.inventoryLedger)
      .where(and(
        eq(schema.inventoryLedger.tenant_id, params.tenantId),
        eq(schema.inventoryLedger.document_type, 'STOCK_TRANSFER'),
        eq(schema.inventoryLedger.document_no, params.shipmentNo),
        eq(schema.inventoryLedger.document_line_id, params.lineId),
        eq(schema.inventoryLedger.transaction_type, 'TRANSFER_SHIPMENT'),
      ));
    const qty = Math.abs(Number(row?.qty ?? 0));
    if (!(qty > 0)) throw new BadRequestException(`Shipment ${params.shipmentNo} has no posted ledger entry for this line.`);
    return Math.abs(Number(row?.amount ?? 0)) / qty;
  }

  /** The receipt event's one ledger leg: into the destination, at the shipment's rate. */
  async writeTransferReceipt(params: {
    tenantId: string; companyId: string; itemId: string; documentNo: string; documentLineId: string;
    postingDate: string; quantity: number; uom: string; toWarehouseId: string; rate: number;
    lotNo?: string; serialNo?: string; userId?: string;
  }) {
    return this.writePositiveEntry({
      tenantId: params.tenantId, companyId: params.companyId, itemId: params.itemId,
      documentType: 'STOCK_TRANSFER', documentNo: params.documentNo, documentLineId: params.documentLineId,
      postingDate: params.postingDate, transactionType: 'TRANSFER_RECEIPT', quantity: params.quantity, uom: params.uom,
      rate: params.rate, lotNo: params.lotNo, serialNo: params.serialNo, warehouseId: params.toWarehouseId, userId: params.userId,
    });
  }
```

(`and`, `eq`, `sql`, `BadRequestException` are already imported by this file — confirm with `head -30`; add any missing.)

- [ ] **Step 5: Use them in `stock-transfer.service.ts`.** In `postShipment`, replace the `writeTransferEntries` call and its two GL posts with:

```ts
        const shipmentEntry = await this.ledgerService.writeTransferShipment({
          tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: shipmentNo, documentLineId: line.line_id,
          postingDate: dto.posting_date, quantity: qty, uom: line.uom, fromWarehouseId: transfer.from_warehouse_id,
          lotNo, serialNo, userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(shipmentEntry, userPayload?.userId);
```

In `postReceipt`, replace its `writeTransferEntries` call and two GL posts with:

```ts
        const rate = await this.ledgerService.transferShipmentRate({ tenantId, shipmentNo: shipment.shipment_no, lineId: line.line_id });
        const receiptEntry = await this.ledgerService.writeTransferReceipt({
          tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: receiptNo, documentLineId: line.line_id,
          postingDate: dto.posting_date, quantity: input.quantity, uom: line.uom, toWarehouseId: transfer.to_warehouse_id, rate,
          lotNo: shipmentLine.lot_no ?? undefined, serialNo: shipmentLine.serial_no ?? undefined, userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(receiptEntry, userPayload?.userId);
```

Leave `postOriginal_superseded` alone (dead, marked for deletion by the 1 Oct plan).

- [ ] **Step 6: Ledger unit test** — append to `inventory-ledger.service.spec.ts` a case for `transferShipmentRate`, using that file's existing db-mock helper: one select returning `[{ amount: '-15', qty: '-6' }]` → `2.5`; one returning `[{ amount: '0', qty: '0' }]` → rejects with `Shipment SH-2026-0001 has no posted ledger entry for this line.`

- [ ] **Step 7: Run** `cd apps/api && npx jest src/modules/inventory --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json` → PASS, 0 errors.

- [ ] **Step 8: Prove it in MySQL.** Rebuild (grep `dist/main.js` for `transferShipmentRate`), restart by PID, repeat Step 1's 1-unit transfer. Expected: exactly **two** rows for the new SH/RC numbers — one `TRANSFER_SHIPMENT` −1 at the source, one `TRANSFER_RECEIPT` +1 at the destination — and the store balance down by exactly 1. Then do a staged pair: `POST /stock-transfer/:id/shipment` 1 of a 2-unit draft, read the ledger (source −1, destination unchanged), `POST …/receipt` 1 against it (destination +1). Paste the SQL output into the commit body. Reverse the test stock with a stock adjustment only if Rishi asks; otherwise note the two movements in the verification report.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.spec.ts apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts apps/api/src/modules/inventory/stock-transfer/transfer-execution.service.spec.ts apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.spec.ts
git commit -m "fix(transfer): a shipment and its receipt each moved the stock — twice in all

<paste Step 1 before / Step 8 after SQL>

Both staged events called writeTransferEntries, which writes the source
negative AND the destination positive; Direct Transfer runs both, so every
posted transfer since 5c38c1eb doubled. The specs mocked writeTransferEntries,
so nothing failed. A shipment now writes only TRANSFER_SHIPMENT at the source,
a receipt only TRANSFER_RECEIPT at the destination at the shipment's rate
(1 Oct spec 'Transfer execution'; 3 Oct spec Part B cp. 46 'posts received KG
once'). nf_devco had no shipment rows, so no data repair.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Known limitation, not this task:** `FeedForecastService.loadDraftTransfers` still counts a DRAFT transfer's full line quantity as incoming even after part of it was shipped/received through staged events. Feed transfers reach that path only in Part B (Transfer Orders); record it in the verification report's open items for Part B.

---

### Task 5: Migration 0147 — `stock_transfer_line.requisition_line_id`

**Files:**
- Create: `apps/api/src/drizzle/tenant/0147_stock_transfer_line_requisition_line.sql`
- Create: `apps/api/src/drizzle/tenant/part-e-migrations.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`, `apps/api/src/core/database/schema.ts` (`stockTransferLine`, ~line 3975)

**Interfaces:**
- Produces: column `stock_transfer_line.requisition_line_id varchar(36) NULL`, FK → `requisition_line.line_id` ON DELETE SET NULL, index `idx_stock_transfer_line_requisition_line`; Drizzle `stockTransferLine.requisition_line_id`.

**Numbering trap — read before writing the journal.** Drizzle's MySQL migrator applies a migration only when its journal `when` is **greater than** the newest applied migration's `created_at` (`drizzle-orm/mysql-core/dialect.js`: `lastDbMigration.created_at < migration.folderMillis`), not by idx. 0145 has `when: 1792000000014`. This plan gives 0147 `when: 1792000000016`. **The deferred 0146 must be journalled later with a `when` greater than 0147's** (e.g. `1792000000017`), or every database that already ran 0147 will skip 0146 silently. Write that sentence into the commit body and into the 0146 row of the Part A plan's File Structure.

- [ ] **Step 1: Failing migration test**

```ts
// apps/api/src/drizzle/tenant/part-e-migrations.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0147 — requisition line on the transfer line (Part E, additive)', () => {
  it('is journalled at idx 147 with a when after 0145, leaving 146 for the deferred drop', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 147)).toEqual({ idx: 147, version: '5', when: 1792000000016, tag: '0147_stock_transfer_line_requisition_line', breakpoints: true });
    expect(entries.find((e) => e.idx === 146)).toBeUndefined();
    expect(1792000000016).toBeGreaterThan(entries.find((e) => e.idx === 145)!.when);
  });

  it('adds one nullable column, its FK and an index — nothing destructive', () => {
    expect(statements('0147_stock_transfer_line_requisition_line')).toEqual([
      'ALTER TABLE `stock_transfer_line` ADD `requisition_line_id` varchar(36);',
      'ALTER TABLE `stock_transfer_line` ADD CONSTRAINT `stock_transfer_line_requisition_line_fk` FOREIGN KEY (`requisition_line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE set null ON UPDATE no action;',
      'CREATE INDEX `idx_stock_transfer_line_requisition_line` ON `stock_transfer_line` (`requisition_line_id`);',
    ]);
  });
});
```

(Read `feed-tdd-migrations.spec.ts` first: if its `toEqual` journal objects include `version` and `breakpoints`, as shown, keep them; the type annotation above is narrowed only for the lookups.)

- [ ] **Step 2: Run** `cd apps/api && npx jest src/drizzle/tenant/part-e-migrations.spec.ts --maxWorkers=2` → FAIL (file missing).

- [ ] **Step 3: Write the SQL** (`0147_stock_transfer_line_requisition_line.sql`)

```sql
-- Part E (2026-10-04): a Store requisition's release creates one stock transfer whose lines
-- each name the requisition line they fulfil, so shipments and receipts can be written back
-- to requisition_line.qty_shipped / qty_received (1 Oct plan Task 8 quantities; 3 Oct spec
-- Part B "TO lines carry requisition line"). Additive and nullable: existing transfers keep NULL.
-- 0146 is reserved for the deferred feed-era drop and MUST be journalled with a `when` greater
-- than this file's (drizzle applies by `when`, not idx).
ALTER TABLE `stock_transfer_line` ADD `requisition_line_id` varchar(36);--> statement-breakpoint
ALTER TABLE `stock_transfer_line` ADD CONSTRAINT `stock_transfer_line_requisition_line_fk` FOREIGN KEY (`requisition_line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_transfer_line_requisition_line` ON `stock_transfer_line` (`requisition_line_id`);
```

Append to `_journal.json` `entries` (after idx 145):

```json
    {
      "idx": 147,
      "version": "5",
      "when": 1792000000016,
      "tag": "0147_stock_transfer_line_requisition_line",
      "breakpoints": true
    }
```

In `schema.ts`, `stockTransferLine`, after `remarks`:

```ts
  // Part E (0147): the requisition line this transfer line fulfils — set when a Store
  // requisition is released; NULL on every hand-made transfer.
  requisition_line_id: varchar('requisition_line_id', { length: 36 }),
```

and add the index to its table options (create the `(table) => ({…})` block, `stockTransferLine` has none today):

```ts
}, (table) => ({
  requisitionLineIdx: index('idx_stock_transfer_line_requisition_line').on(table.requisition_line_id),
}));
```

The FK is **not** declared in Drizzle: `requisitionLine` is declared ~470 lines later, and a `foreignKey()` to it from here is a use-before-declaration. The SQL file creates the FK; the comment on the column says so. (0141 handled `requisition.linked_transfer_id` the other way round because `stockTransfer` is declared first.)

- [ ] **Step 4: Run** the migration spec → PASS; `npx tsc --noEmit -p tsconfig.app.json` → 0.

- [ ] **Step 5: Apply locally and read it back.** Back up first: `mysqldump -u root nf_devco stock_transfer_line > /private/tmp/claude-501/nf_devco-stock_transfer_line-pre0147.sql`. Then from `apps/api`: `node --env-file-if-exists=.env --import tsx src/scripts/migrate-all-tenants.ts` (never the nx target). Read back for every tenant DB the script names:

```sql
select column_name, is_nullable from information_schema.columns where table_schema='nf_devco' and table_name='stock_transfer_line' and column_name='requisition_line_id';
select count(*) from nf_devco.__drizzle_migrations;
select hash, created_at from nf_devco.__drizzle_migrations order by created_at desc limit 1;
```

Expected: the column exists, nullable; the newest `created_at` is `1792000000016`. Repeat for `nf_system` only if the script reports it as a tenant DB.

- [ ] **Step 6: Commit** — `feat(db): 0147 — a transfer line names the requisition line it fulfils (additive)`, body with the read-back output and the 0146 `when` warning; stage the four files.

---

### Task 6: Store release creates the linked stock transfer

**Files:**
- Modify: `apps/api/src/modules/procurement/requisition/requisition.rules.ts` (+ spec), `requisition.service.ts` (`release`), `requisition.module.ts`
- Modify: `apps/api/src/modules/inventory/stock-transfer/dto/stock-transfer.dto.ts` (`StockTransferLineInput`), `stock-transfer.service.ts` (`insertLines`)
- Test: `requisition.rules.spec.ts`, `requisition.release.spec.ts`

**Interfaces:**
- Consumes: Task 5 column; `StockTransferService.create(dto: CreateStockTransferDto, tenantId, userPayload)` (returns `findOne(transferId)` with `transfer_id`, `transfer_no`).
- Produces: `transferPlanFor(header: { from_location_id: string | null; to_location_id: string | null }, lines: Array<{ line_id: string; line_seq: number; item_id: string | null; quantity: unknown; uom: string; qty_to_ship?: unknown; from_location_id?: string | null; to_location_id?: string | null }>): { fromLocationId: string; toLocationId: string; lines: Array<{ requisition_line_id: string; item_id: string; quantity: number; uom: string }> }`.
- Produces: `StockTransferLineInput.requisition_line_id?: string` (IsUUID, optional) written by `insertLines`.
- Produces: a released Store requisition has `linked_transfer_id` set, `fulfilment_status 'TRANSFER_OPEN'`; `RequisitionService` constructor gains `@Optional() private readonly stockTransfers?: StockTransferService` (optional so the existing specs' two-argument constructions still compile).

- [ ] **Step 1: Failing rules test**

```ts
describe('transferPlanFor — Store release starts one internal transfer (decisions 1 Oct)', () => {
  const header = { from_location_id: 'st', to_location_id: 'sh' };
  const line = (over: Record<string, unknown> = {}) => ({ line_id: 'l1', line_seq: 1, item_id: 'i1', quantity: '10', uom: 'EA', qty_to_ship: '6', from_location_id: 'st', to_location_id: 'sh', ...over });
  it('ships each line its to-ship quantity between the header locations', () => {
    expect(transferPlanFor(header, [line()])).toEqual({ fromLocationId: 'st', toLocationId: 'sh', lines: [{ requisition_line_id: 'l1', item_id: 'i1', quantity: 6, uom: 'EA' }] });
  });
  it('falls back to the requested quantity on a line with no to-ship target', () => {
    expect(transferPlanFor(header, [line({ qty_to_ship: null })]).lines[0].quantity).toBe(10);
  });
  it('refuses a line routed between other locations than the header', () => {
    expect(() => transferPlanFor(header, [line({ line_seq: 2, to_location_id: 'other' })]))
      .toThrow('Line 2 moves between other locations than the header; one transfer has one source and one destination.');
  });
  it('refuses a header with no source or destination', () => {
    expect(() => transferPlanFor({ from_location_id: null, to_location_id: 'sh' }, [line()])).toThrow('A Store requisition needs a source and a destination before release.');
  });
  it('refuses a line without an item', () => {
    expect(() => transferPlanFor(header, [line({ item_id: null })])).toThrow('Line 1 has no item; a Store transfer moves Item Master items only.');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (append to rules)

```ts
/**
 * decisions 1 Oct: "Store release starts an internal transfer." One transfer
 * per requisition: stock_transfer has one source and one destination, so a
 * line routed elsewhere is refused rather than silently moved between the
 * header's locations (Review Focus 5). Quantity is the authorized to-ship
 * target (lineBalances), never more — over-shipment stays impossible.
 */
export function transferPlanFor(
  header: { from_location_id: string | null; to_location_id: string | null },
  lines: Array<{ line_id: string; line_seq: number; item_id: string | null; quantity: unknown; uom: string; qty_to_ship?: unknown; from_location_id?: string | null; to_location_id?: string | null }>,
) {
  if (!header.from_location_id || !header.to_location_id) {
    throw new BadRequestException('A Store requisition needs a source and a destination before release.');
  }
  const fromLocationId = header.from_location_id;
  const toLocationId = header.to_location_id;
  return {
    fromLocationId,
    toLocationId,
    lines: lines.map((l) => {
      if (!l.item_id) throw new BadRequestException(`Line ${l.line_seq} has no item; a Store transfer moves Item Master items only.`);
      if ((l.from_location_id && l.from_location_id !== fromLocationId) || (l.to_location_id && l.to_location_id !== toLocationId)) {
        throw new BadRequestException(`Line ${l.line_seq} moves between other locations than the header; one transfer has one source and one destination.`);
      }
      return { requisition_line_id: l.line_id, item_id: l.item_id, quantity: lineBalances(l).qty_to_ship, uom: l.uom };
    }),
  };
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Failing release test** — in `requisition.release.spec.ts`, read how it builds the service and its db mock first; then pass a third constructor argument `stockTransfers = { create: jest.fn().mockResolvedValue({ transfer_id: 'tr-1', transfer_no: 'TR-000001' }) }` everywhere a Store release is exercised, and add:

```ts
it('a Store release creates the linked transfer with one line per requisition line and records it', async () => {
  // queue: locked row (APPROVED Store, from 'st' to 'sh'), its lines, then findOne's reads
  // …use the file's existing helpers for the header and permission mocks…
  expect(stockTransfers.create).toHaveBeenCalledWith(expect.objectContaining({
    company_id: 'co-1', from_warehouse_id: 'st', to_warehouse_id: 'sh',
    lines: [expect.objectContaining({ item_id: 'item-1', quantity: 6, uom: 'KG', requisition_line_id: 'line-1' })],
  }), TENANT, expect.anything());
  expect(setCalls.at(-1)).toMatchObject({ document_status: 'RELEASED', fulfilment_status: 'TRANSFER_OPEN', linked_transfer_id: 'tr-1' });
});

it('a Purchase release creates no transfer', async () => {
  // …Purchase row…
  expect(stockTransfers.create).not.toHaveBeenCalled();
  expect(setCalls.at(-1)).toMatchObject({ integration_status: 'BC_PENDING' });
});
```

Write the two `// …` setups concretely from the file's existing Store and Purchase release cases (copy their queue pushes, then add the lines row `[lineRow({ qty_to_ship: '6', from_location_id: 'st', to_location_id: 'sh' })]` after the locked header row). Expected run: FAIL.

- [ ] **Step 6: Implement**

`stock-transfer.dto.ts`, in `StockTransferLineInput`:

```ts
  @ApiProperty({ description: 'Part E: the requisition line this transfer line fulfils (set by Store release)', required: false })
  @IsUUID()
  @IsOptional()
  requisition_line_id?: string;
```

`stock-transfer.service.ts` `insertLines`: add `requisition_line_id: line.requisition_line_id ?? null,` to the mapped row.

`requisition.module.ts`: `imports: [ApprovalModule, StockTransferModule]` (import path `../../inventory/stock-transfer/stock-transfer.module`).

`requisition.service.ts`: constructor

```ts
  constructor(
    private readonly cls: ClsService,
    private readonly approvals: ApprovalService,
    // Part E: a Store release creates its transfer through the transfer service, not a second writer.
    @Optional() private readonly stockTransfers?: StockTransferService,
  ) {}
```

(import `Optional` from `@nestjs/common`, `StockTransferService` from `../../inventory/stock-transfer/stock-transfer.service`, `transferPlanFor` from the rules.)

In `release()`, after `const transition = releaseTransition(...)` and before the update:

```ts
      let linkedTransferId: string | null = row.linked_transfer_id ?? null;
      if (row.purpose !== 'PURCHASE') {
        const lines = await this.db
          .select({
            line_id: schema.requisitionLine.line_id, line_seq: schema.requisitionLine.line_seq, item_id: schema.requisitionLine.item_id,
            quantity: schema.requisitionLine.quantity, uom: schema.requisitionLine.uom, qty_to_ship: schema.requisitionLine.qty_to_ship,
            from_location_id: schema.requisitionLine.from_location_id, to_location_id: schema.requisitionLine.to_location_id,
          })
          .from(schema.requisitionLine)
          .where(eq(schema.requisitionLine.requisition_id, requisitionId))
          .orderBy(schema.requisitionLine.line_seq);
        const plan = transferPlanFor(row, lines);
        if (!this.stockTransfers) throw new Error('StockTransferService is not wired into RequisitionModule.');
        const transfer = await this.stockTransfers.create({
          company_id: row.company_id,
          posting_date: nowTs().slice(0, 10),
          from_warehouse_id: plan.fromLocationId,
          to_warehouse_id: plan.toLocationId,
          remarks: `Requisition ${row.req_no}`,
          lines: plan.lines,
        } as any, tenantId, userPayload);
        linkedTransferId = transfer.transfer_id;
      }
```

and add `linked_transfer_id: linkedTransferId,` to the release `.set({...})`.

- [ ] **Step 7: Run** `cd apps/api && npx jest src/modules/procurement src/modules/inventory/stock-transfer --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json` → PASS, 0. Also boot-check the DI graph: build the API (Global Constraints command) and start it; it must start without `Nest can't resolve dependencies` and without a circular-import warning. Stop it by PID.

- [ ] **Step 8: Commit** — `feat(requisition): Store release creates its stock transfer` (body: `releaseTransition` set TRANSFER_OPEN but no transfer existed, so a released Store requisition had nothing to ship against; quote decisions 1 Oct "Store release starts an internal transfer"; a line routed elsewhere than the header is refused).

---

### Task 7: Ship and receive from the requisition; the requisition lines follow the events

**Files:**
- Create: `apps/api/src/modules/procurement/requisition/requisition-fulfilment.ts`, `requisition-fulfilment.spec.ts`
- Modify: `requisition.rules.ts` (+ spec), `requisition.service.ts`, `requisition.controller.ts`, `dto/requisition.dto.ts`
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts` (call the sync at the end of `postShipment` and `postReceipt`)

**Interfaces:**
- Produces (rules): `fulfilmentStatusOf(lines: Array<{ quantity: unknown; qty_to_ship?: unknown; qty_shipped?: unknown; qty_to_receive?: unknown; qty_received?: unknown }>): FulfilmentStatus`; `mapToTransferLines(inputs: { line_id: string; quantity: number }[], transferLines: { line_id: string; requisition_line_id: string | null }[]): { line_id: string; quantity: number }[]`.
- Produces: `syncRequisitionFulfilment(db: MySql2Database<typeof schema>, transferId: string): Promise<void>` — no-op for a transfer no requisition links to.
- Produces endpoints (permission `INVENTORY/STOCK_TRANSFER/edit`, the pair the transfer endpoints already use — no new permission pair, so `role-permissions-coverage` holds):
  - `POST /requisition/:id/shipment` body `RequisitionShipmentDto { posting_date: string; lines: { line_id: string /* requisition line */; quantity: number }[] }`
  - `POST /requisition/:id/receipt` body `RequisitionReceiptDto { posting_date: string; shipment_id: string; lines: { line_id: string; quantity: number }[] }`
  - both return `findOne`.
- Produces on `findOne`: `shipments: Array<{ shipment_id: string; shipment_no: string; shipment_date: string; lines: Array<{ requisition_line_id: string; shipped: number; received: number; remaining: number }> }>` (empty array when no linked transfer).

- [ ] **Step 1: Failing rules tests**

```ts
describe('fulfilmentStatusOf — partial shipment and receipt are allowed (decisions 1 Oct)', () => {
  const l = (shipped: number, received: number, toShip = 10) => ({ quantity: '10', qty_to_ship: String(toShip), qty_shipped: shipped, qty_to_receive: String(toShip), qty_received: received });
  it.each([
    [[l(0, 0)], 'TRANSFER_OPEN'],
    [[l(6, 0)], 'PARTIALLY_SHIPPED'],
    [[l(10, 0)], 'SHIPPED'],
    [[l(6, 4)], 'PARTIALLY_RECEIVED'],
    [[l(10, 10)], 'RECEIVED'],
    [[l(10, 10), l(0, 0)], 'PARTIALLY_RECEIVED'],
    [[l(10, 0), l(4, 0)], 'PARTIALLY_SHIPPED'],
  ])('%j → %s', (lines, status) => expect(fulfilmentStatusOf(lines)).toBe(status));
});

describe('mapToTransferLines', () => {
  const tl = [{ line_id: 't1', requisition_line_id: 'r1' }, { line_id: 't2', requisition_line_id: 'r2' }];
  it('maps requisition lines to their transfer lines', () => {
    expect(mapToTransferLines([{ line_id: 'r2', quantity: 3 }], tl)).toEqual([{ line_id: 't2', quantity: 3 }]);
  });
  it('refuses a line the linked transfer does not carry', () => {
    expect(() => mapToTransferLines([{ line_id: 'r9', quantity: 1 }], tl)).toThrow('Requisition line r9 is not on the linked transfer.');
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (append to rules)

```ts
const EPS = 1e-9;

/** The fulfilment dimension from the line quantities (1 Oct spec "Common requisition"). Received outranks shipped. */
export function fulfilmentStatusOf(lines: Array<{ quantity: unknown; qty_to_ship?: unknown; qty_shipped?: unknown; qty_to_receive?: unknown; qty_received?: unknown }>): FulfilmentStatus {
  const b = lines.map((l) => lineBalances(l));
  const anyReceived = b.some((l) => l.qty_received > EPS);
  const allReceived = b.every((l) => l.remaining_to_receive <= EPS);
  const anyShipped = b.some((l) => l.qty_shipped > EPS);
  const allShipped = b.every((l) => l.balance_to_ship <= EPS);
  if (anyReceived && allReceived) return 'RECEIVED';
  if (anyReceived) return 'PARTIALLY_RECEIVED';
  if (anyShipped && allShipped) return 'SHIPPED';
  if (anyShipped) return 'PARTIALLY_SHIPPED';
  return 'TRANSFER_OPEN';
}

export function mapToTransferLines(
  inputs: Array<{ line_id: string; quantity: number }>,
  transferLines: Array<{ line_id: string; requisition_line_id: string | null }>,
): Array<{ line_id: string; quantity: number }> {
  return inputs.map((input) => {
    const target = transferLines.find((t) => t.requisition_line_id === input.line_id);
    if (!target) throw new BadRequestException(`Requisition line ${input.line_id} is not on the linked transfer.`);
    return { line_id: target.line_id, quantity: input.quantity };
  });
}
```

Run → PASS.

- [ ] **Step 4: Failing sync test** (`requisition-fulfilment.spec.ts`)

```ts
import { syncRequisitionFulfilment } from './requisition-fulfilment';
import * as schema from '../../../core/database/schema';

function db(queues: unknown[][]) {
  const sets: Array<{ table: unknown; values: any }> = [];
  const select = jest.fn(() => {
    const rows = queues.shift() ?? [];
    const self: any = {};
    for (const m of ['from', 'where', 'innerJoin', 'leftJoin', 'groupBy', 'limit']) self[m] = () => self;
    self.then = (ok: any, err: any) => Promise.resolve(rows).then(ok, err);
    return self;
  });
  const update = jest.fn((table: unknown) => ({ set: jest.fn((values: any) => { sets.push({ table, values }); return { where: jest.fn(async () => undefined) }; }) }));
  return { db: { select, update } as any, sets };
}

describe('syncRequisitionFulfilment', () => {
  it('does nothing for a transfer no requisition links to', async () => {
    const { db: d, sets } = db([[]]);
    await syncRequisitionFulfilment(d, 'tr-x');
    expect(sets).toEqual([]);
  });

  it('writes shipped/received per requisition line and the fulfilment status', async () => {
    const { db: d, sets } = db([
      [{ requisition_id: 'req-1' }],                                                         // linked requisition
      [{ requisition_line_id: 'l1', qty: '6' }],                                             // shipped sums
      [{ requisition_line_id: 'l1', qty: '4' }],                                             // received sums
      [{ line_id: 'l1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }],          // requisition lines
    ]);
    await syncRequisitionFulfilment(d, 'tr-1');
    expect(sets.filter((s) => s.table === schema.requisitionLine).map((s) => s.values)).toEqual([{ qty_shipped: '6', qty_received: '4' }]);
    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 5: Implement `requisition-fulfilment.ts`**

```ts
/**
 * Part E Task 7: a linked requisition follows its transfer's events. Called by
 * StockTransferService at the end of postShipment/postReceipt inside the same
 * transaction, so a shipment posted from either screen updates the requisition.
 * A plain function (not a provider) so the inventory module does not import
 * the procurement module — the same direction transfer-execution.rules.ts
 * already uses for requisition.rules.ts.
 */
import { eq, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { fulfilmentStatusOf } from './requisition.rules';

export async function syncRequisitionFulfilment(db: MySql2Database<typeof schema>, transferId: string): Promise<void> {
  const [linked] = await db
    .select({ requisition_id: schema.requisition.requisition_id })
    .from(schema.requisition)
    .where(eq(schema.requisition.linked_transfer_id, transferId));
  if (!linked) return;
  const shipped = await db
    .select({ requisition_line_id: schema.stockTransferLine.requisition_line_id, qty: sql<string>`SUM(${schema.transferShipmentLine.quantity})` })
    .from(schema.transferShipmentLine)
    .innerJoin(schema.stockTransferLine, eq(schema.stockTransferLine.line_id, schema.transferShipmentLine.line_id))
    .where(eq(schema.stockTransferLine.transfer_id, transferId))
    .groupBy(schema.stockTransferLine.requisition_line_id);
  const received = await db
    .select({ requisition_line_id: schema.stockTransferLine.requisition_line_id, qty: sql<string>`SUM(${schema.transferReceiptLine.quantity})` })
    .from(schema.transferReceiptLine)
    .innerJoin(schema.stockTransferLine, eq(schema.stockTransferLine.line_id, schema.transferReceiptLine.line_id))
    .where(eq(schema.stockTransferLine.transfer_id, transferId))
    .groupBy(schema.stockTransferLine.requisition_line_id);
  const lines = await db
    .select({ line_id: schema.requisitionLine.line_id, quantity: schema.requisitionLine.quantity, qty_to_ship: schema.requisitionLine.qty_to_ship, qty_to_receive: schema.requisitionLine.qty_to_receive })
    .from(schema.requisitionLine)
    .where(eq(schema.requisitionLine.requisition_id, linked.requisition_id));
  const sum = (rows: Array<{ requisition_line_id: string | null; qty: string }>, id: string) => Number(rows.find((r) => r.requisition_line_id === id)?.qty ?? 0);
  const updated = [];
  for (const line of lines) {
    const qtyShipped = sum(shipped, line.line_id);
    const qtyReceived = sum(received, line.line_id);
    await db.update(schema.requisitionLine).set({ qty_shipped: String(qtyShipped), qty_received: String(qtyReceived) }).where(eq(schema.requisitionLine.line_id, line.line_id));
    updated.push({ ...line, qty_shipped: qtyShipped, qty_received: qtyReceived });
  }
  await db.update(schema.requisition).set({ fulfilment_status: fulfilmentStatusOf(updated) }).where(eq(schema.requisition.requisition_id, linked.requisition_id));
}
```

Note: the event tables have `deleted_at` on the header only; events are append-only and never soft-deleted by any code today (grep `transfer_shipment` updates to confirm). If one is found, add `isNull(schema.transferShipment.deleted_at)` via an inner join on the header.

Run the sync spec → PASS.

- [ ] **Step 6: Call it from StockTransferService.** At the end of `postShipment`'s transaction body (after the audit log, before `return`) and of `postReceipt`'s:

```ts
      // Part E: a requisition linked to this transfer follows its events.
      await syncRequisitionFulfilment(this.db, id);
```

(import from `../../procurement/requisition/requisition-fulfilment`). Add `[schema.requisition, [[]]]` to `baseQueues()` in `transfer-execution.service.spec.ts` so the sync's first read finds no linked requisition and the existing tests stay as they were; add one test there with `[schema.requisition, [[{ requisition_id: 'req-1' }]]]` asserting an update on `schema.requisition` with `fulfilment_status`. (The recording db pops by FROM table — read the header comment of that spec.)

- [ ] **Step 7: Requisition endpoints.** DTOs (`dto/requisition.dto.ts`):

```ts
export class RequisitionEventLineInput {
  @ApiProperty({ description: 'Requisition line UUID' }) @IsUUID() line_id: string;
  @ApiProperty() @IsNumber() @Min(0.0001) @Type(() => Number) quantity: number;
}
export class RequisitionShipmentDto {
  @ApiProperty() @IsDateString() posting_date: string;
  @ApiProperty({ type: [RequisitionEventLineInput] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RequisitionEventLineInput) lines: RequisitionEventLineInput[];
}
export class RequisitionReceiptDto extends RequisitionShipmentDto {
  @ApiProperty({ description: 'The shipment this receipt receives against' }) @IsUUID() shipment_id: string;
}
```

Service:

```ts
  /** A released Store requisition's linked transfer and its lines, locked through the transfer service's own load. */
  private async releasedStore(requisitionId: string, tenantId: string) {
    const [row] = await this.db.select().from(schema.requisition)
      .where(and(eq(schema.requisition.requisition_id, requisitionId), eq(schema.requisition.tenant_id, tenantId), isNull(schema.requisition.deleted_at), ...this.scopeConditions()))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    const states = projectRequisitionStates(row);
    if (row.purpose !== 'STORE' || states.document_status !== 'RELEASED' || !row.linked_transfer_id) {
      throw new BadRequestException('Only a released Store requisition ships and receives; release it first.');
    }
    const transferLines = await this.db
      .select({ line_id: schema.stockTransferLine.line_id, requisition_line_id: schema.stockTransferLine.requisition_line_id })
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, row.linked_transfer_id));
    return { row, transferId: row.linked_transfer_id, transferLines };
  }

  async ship(requisitionId: string, dto: RequisitionShipmentDto, tenantId: string, userPayload?: { userId?: string }) {
    const { transferId, transferLines } = await this.releasedStore(requisitionId, tenantId);
    await this.stockTransfers!.postShipment(transferId, { posting_date: dto.posting_date, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
    return this.findOne(requisitionId, tenantId);
  }

  async receive(requisitionId: string, dto: RequisitionReceiptDto, tenantId: string, userPayload?: { userId?: string }) {
    const { transferId, transferLines } = await this.releasedStore(requisitionId, tenantId);
    await this.stockTransfers!.postReceipt(transferId, { posting_date: dto.posting_date, shipment_id: dto.shipment_id, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
    return this.findOne(requisitionId, tenantId);
  }
```

In `findOne`, after Task 3's name reads, when `row.linked_transfer_id` is set, read the shipments:

```ts
    let shipments: Array<{ shipment_id: string; shipment_no: string; shipment_date: string; lines: Array<{ requisition_line_id: string; shipped: number; received: number; remaining: number }> }> = [];
    if (row.linked_transfer_id) {
      const shipped = await this.db
        .select({
          shipment_id: schema.transferShipment.shipment_id, shipment_no: schema.transferShipment.shipment_no, shipment_date: schema.transferShipment.shipment_date,
          shipment_line_id: schema.transferShipmentLine.shipment_line_id, requisition_line_id: schema.stockTransferLine.requisition_line_id, qty: schema.transferShipmentLine.quantity,
        })
        .from(schema.transferShipment)
        .innerJoin(schema.transferShipmentLine, eq(schema.transferShipmentLine.shipment_id, schema.transferShipment.shipment_id))
        .innerJoin(schema.stockTransferLine, eq(schema.stockTransferLine.line_id, schema.transferShipmentLine.line_id))
        .where(and(eq(schema.transferShipment.transfer_id, row.linked_transfer_id), isNull(schema.transferShipment.deleted_at)))
        .orderBy(schema.transferShipment.shipment_no);
      const receivedRows = await this.db
        .select({ shipment_line_id: schema.transferReceiptLine.shipment_line_id, qty: sql<string>`SUM(${schema.transferReceiptLine.quantity})` })
        .from(schema.transferReceiptLine)
        .innerJoin(schema.transferReceipt, eq(schema.transferReceipt.receipt_id, schema.transferReceiptLine.receipt_id))
        .where(and(eq(schema.transferReceipt.transfer_id, row.linked_transfer_id), isNull(schema.transferReceipt.deleted_at)))
        .groupBy(schema.transferReceiptLine.shipment_line_id);
      const receivedOf = new Map(receivedRows.map((r) => [r.shipment_line_id, Number(r.qty)]));
      const byShipment = new Map<string, (typeof shipments)[number]>();
      for (const s of shipped) {
        const entry = byShipment.get(s.shipment_id) ?? { shipment_id: s.shipment_id, shipment_no: s.shipment_no, shipment_date: s.shipment_date, lines: [] };
        const shippedQty = Number(s.qty);
        const receivedQty = receivedOf.get(s.shipment_line_id) ?? 0;
        entry.lines.push({ requisition_line_id: s.requisition_line_id ?? '', shipped: shippedQty, received: receivedQty, remaining: shippedQty - receivedQty });
        byShipment.set(s.shipment_id, entry);
      }
      shipments = [...byShipment.values()];
    }
```

and return `shipments` on the view. Controller (import the DTOs):

```ts
  @Post(':id/shipment')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial shipment against a released Store requisition (its linked transfer)' })
  @ApiParam({ name: 'id' })
  async ship(@Param('id') id: string, @Body() dto: RequisitionShipmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Shipment posted.', data: await this.requisitions.ship(id, dto, tenantId, req.user) };
  }

  @Post(':id/receipt')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial receipt against one shipment of a released Store requisition' })
  @ApiParam({ name: 'id' })
  async receive(@Param('id') id: string, @Body() dto: RequisitionReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Receipt posted.', data: await this.requisitions.receive(id, dto, tenantId, req.user) };
  }
```

Add a service test: `ship()` on a requisition whose `document_status` is `APPROVED` (not released) rejects with `Only a released Store requisition ships and receives; release it first.` before calling `stockTransfers.postShipment`.

- [ ] **Step 8: Run** `cd apps/api && npx jest src/modules/procurement src/modules/inventory --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json` → PASS, 0. Run `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 specs/role-permissions-coverage.spec.ts` → PASS (no new pair).

- [ ] **Step 9: Commit** — `feat(requisition): ship and receive a released Store requisition; its lines follow the transfer events` (quote decisions 1 Oct "Partial shipment and receipt are allowed; over-shipment and over-receipt are rejected"; the qty_shipped/qty_received columns existed but nothing ever wrote them).

---

### Task 8: A manual feed line is checked against the lifecycle-required item (Req. row 13)

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (+ `.rules.spec.ts`), `feed-requisition.service.ts` (`createManual` ~768), `dto/feed-requisition.dto.ts` (`ManualFeedLineInput`)
- Test: `feed-requisition.service.spec.ts` (first `describe('FeedRequisitionService.createManual')`)

**Interfaces:**
- Consumes: `lineChangeProblems`, `ITEM_EXCEPTION_PROBLEM`, `SILO_HOLDS_OTHER_PROBLEM`, `EXCEPTION_PREFIX` (Task 9 of Part A); `forecast.computeForFarm(farmId, companyId, tenantId, draftForecastRange(today, undefined), clock)`; `siloFeed.currentItems(ids, companyId, tenantId)`.
- Produces: `requiredItemForManualLine(sources: Array<{ locationId: string; itemId: string }>, destinationId: string, itemId: string): string | null`; `ManualFeedLineInput.exception_reason?: string` (MaxLength 180, same as the edit input).

What Task 9 already enforces (do not rebuild): the **edit** path (`changeLineTarget`) runs `lineChangeProblems` for a changed item/silo, stores the reason as `description = "Exception: …"`, and `approvalProblems` requires header remarks on an exception at submit. What it does not: `createManual` never checks the item ("A line with no lifecycle requirement (a manual line) has nothing to differ from", `feed-requisition.rules.ts` ~line 372). §6a now requires it for manual lines from both entry points.

- [ ] **Step 1: Failing rules test**

```ts
describe('requiredItemForManualLine — §6a: a manual line is checked against the lifecycle-required item', () => {
  const sources = [{ locationId: 'silo-1', itemId: 'r1' }, { locationId: 'silo-1', itemId: 'r2' }, { locationId: 'silo-2', itemId: 'r3' }];
  it('is the item itself when the forecast demands it there (current or next diet)', () => {
    expect(requiredItemForManualLine(sources, 'silo-1', 'r2')).toBe('r2');
  });
  it('is a demanded item when the line names another', () => {
    expect(requiredItemForManualLine(sources, 'silo-1', 'r9')).toBe('r1');
  });
  it('is null where nothing is demanded, so there is nothing to differ from', () => {
    expect(requiredItemForManualLine(sources, 'store-1', 'r9')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `cd apps/api && npx jest src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts --maxWorkers=2` → FAIL. **Step 3: Implement**

```ts
/**
 * Spec §6a (Rishi, 3 Oct): "A manual feed line's item is checked against the
 * lifecycle-required item for that silo's sheds; a different item needs a
 * recorded exception reason (Req. row 13)." The required items at a
 * destination are those the forecast demands there in the draft window (the
 * engine's sources). Returns the line's own item when it is one of them, a
 * demanded item when it is not (so lineChangeProblems reports the exception),
 * and null when nothing is demanded there.
 */
export function requiredItemForManualLine(sources: Array<{ locationId: string; itemId: string }>, destinationId: string, itemId: string): string | null {
  const here = [...new Set(sources.filter((s) => s.locationId === destinationId).map((s) => s.itemId))].sort();
  if (!here.length) return null;
  return here.includes(itemId) ? itemId : here[0];
}
```

Run → PASS.

- [ ] **Step 4: Failing service test** (inside the first `describe('FeedRequisitionService.createManual')`)

```ts
  it('refuses a manual line ordering an item the lifecycle does not require, without an exception reason (Req. row 13)', async () => {
    const silo = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null };
    selectQueue.push([{ location_code: 'GRS' }], [silo], [{ item_id: 'r2', item_name: 'Grower R2' }]);
    const fc = { ...forecast, computeForFarm: jest.fn(async () => ({ sources: [{ locationId: 'silo-1', itemId: 'r1' }] })) };
    const siloFeed = { currentItems: jest.fn(async () => new Map()) };
    const svc = new FeedRequisitionService(transactionCls(db), fc, {} as any, { evaluateFarmSafely: jest.fn() } as any, siloFeed as any, {} as any, feedSettingsStub);
    const line = { destination_location_id: 'silo-1', item_id: 'r2', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' };
    await expect(svc.createManual({ lines: [line] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow('Line 1: Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13).');
    expect(db.insert).not.toHaveBeenCalled();
  });
```

(Compare the constructor argument order with the service's constructor — cls, forecast, approvals, feedAlerts, siloFeed, ledger, feedSettings — and with the existing `service` construction in this describe; adjust if Part A changed it.) Run → FAIL (no refusal; it reaches `farmToday` / the transaction).

- [ ] **Step 5: Implement.** DTO, in `ManualFeedLineInput`:

```ts
  @ApiPropertyOptional({ description: 'Requisition row 13: why the line orders an item the lifecycle does not require' })
  @IsOptional() @IsString() @MaxLength(180) exception_reason?: string;
```

In `createManual`, after the `missing` item check and before `farmToday`:

```ts
      // §6a / Req. row 13 and checkpoint 4 for a manual line — the same two rules an edited line meets
      // (lineChangeProblems), with the requirement read from the forecast's demand at that destination.
      const clock = await this.forecast.farmToday(companyId, tenantId);
      const demand = await this.forecast.computeForFarm(farmId, companyId, tenantId, draftForecastRange(clock.today, undefined), clock);
      const siloIds = dto.lines.map((l) => l.destination_location_id).filter((id) => destinations.get(id)?.locationType === 'SILO');
      const held = siloIds.length ? await this.siloFeed.currentItems(siloIds, companyId, tenantId) : new Map();
      dto.lines.forEach((line, i) => {
        const dest = destinations.get(line.destination_location_id)!;
        const resident = held.get(line.destination_location_id) ?? null;
        const problems = lineChangeProblems({
          requiredItemId: requiredItemForManualLine(demand.sources, line.destination_location_id, line.item_id),
          itemId: line.item_id,
          exceptionReason: line.exception_reason?.trim() || null,
          destination: { locationType: dest.locationType, heldItemId: resident?.item_id ?? null, heldBalanceKg: resident?.on_hand_qty ?? 0 },
        });
        if (problems.length) throw new BadRequestException(problems.map((p) => `Line ${i + 1}: ${p}`).join(' '));
      });
```

Reuse that `clock.today` for the existing `manualToday` (replace the second `farmToday` call: `const manualToday = clock.today;`) so the date is read once. Inside the `forEach` above, also record each exception line's reason:

```ts
      const exceptionOf = new Map<number, string>(); // declared before the forEach
      // …inside the forEach, after the problems check:
        const required = requiredItemForManualLine(demand.sources, line.destination_location_id, line.item_id);
        if (required !== null && required !== line.item_id) exceptionOf.set(i, line.exception_reason!.trim());
```

and in the line insert store it exactly as the edit path does (`changeLineTarget`):

```ts
            description: (exceptionOf.has(i) ? `${EXCEPTION_PREFIX}${exceptionOf.get(i)}` : (nameOf.get(line.item_id) ?? '')).slice(0, 200),
```

(`exception_reason` is non-empty there: `lineChangeProblems` already refused the line otherwise.) Import `requiredItemForManualLine`, `lineChangeProblems`, `EXCEPTION_PREFIX` from the rules.

- [ ] **Step 6: Run** `cd apps/api && npx jest src/modules/procurement/feed-requisition --maxWorkers=2 && npx tsc --noEmit -p tsconfig.app.json`. Existing createManual tests that now reach `computeForFarm` without a mock will fail: give the shared `forecast` stub `computeForFarm: jest.fn(async () => ({ sources: [] }))` and the shared construction a `siloFeed` stub `{ currentItems: jest.fn(async () => new Map()) }`. Expected: PASS, 0 errors.

- [ ] **Step 7: Commit** — `feat(feed): a manual feed line is checked against the lifecycle item (Req. row 13)`; body quotes spec §6a and says Task 9 had explicitly exempted manual lines ("nothing to differ from"), so either entry point could order any feed into any silo unchallenged; the forecast is the only source of the requirement (no second calculation).

---

### Task 9: Web — the common requisition model and document

**Files:**
- Create: `apps/web/src/components/console/requisitions/common-requisition-model.ts`
- Create: `apps/web/src/components/console/requisitions/common-requisition-document.tsx`
- Modify: `apps/web/src/components/console/inventory/requisition-labels.ts`, `apps/web/src/utils/translations.ts` (`en`)
- Test: `apps/web/specs/common-requisition-model.spec.ts`, `apps/web/specs/common-requisition-document.spec.tsx`

**Interfaces:**
- Consumes: API shapes from Tasks 1–3 and 7 (`GET /requisition/:id`, `GET /requisition/options`).
- Produces (`common-requisition-model.ts`):

```ts
export type CommonDocType = "ITEM" | "FA" | "SERVICE";
export type CommonPurpose = "STORE" | "PURCHASE";
export interface CommonRequisitionLine {
  line_id?: string; line_seq?: number;
  item_id: string | null; item_code?: string | null; item_name?: string | null;
  resource_id: string | null; resource_code?: string | null; resource_name?: string | null;
  description: string | null; quantity: string; uom: string; est_rate: string | null;
  from_location_id: string | null; to_location_id: string | null; from_location_code?: string | null; to_location_code?: string | null;
  qty_to_ship: string | null; qty_shipped?: number | string | null; qty_to_receive: string | null; qty_received?: number | string | null;
  balance_to_ship?: number; remaining_to_receive?: number;
}
export interface CommonShipment { shipment_id: string; shipment_no: string; shipment_date: string; lines: { requisition_line_id: string; shipped: number; received: number; remaining: number }[] }
export interface CommonRequisitionView {
  requisition_id?: string; req_no?: string; company_id: string; farm_id?: string | null;
  doc_type: CommonDocType; purpose: CommonPurpose; status?: string;
  requisition_date: string | null; required_date: string | null;
  main_location_id: string | null; main_location_code?: string | null;
  requester_name?: string | null;
  requester_department_id: string | null; requester_department_name?: string | null;
  sender_department_id: string | null; sender_department_name?: string | null;
  from_location_id: string | null; from_location_code?: string | null;
  to_location_id: string | null; to_location_code?: string | null;
  direct_transfer: boolean; justification: string | null; remarks: string | null;
  approval_status?: string | null; document_status?: string | null; fulfilment_status?: string | null; integration_status?: string | null;
  approval_request_id?: string | null; approved_by_name?: string | null; approved_at?: string | null;
  released_by_name?: string | null; released_at?: string | null; linked_po_no?: string | null; linked_transfer_no?: string | null;
  lines: CommonRequisitionLine[]; shipments?: CommonShipment[];
}
export interface CommonRequisitionOptions {
  items: { item_id: string; item_code: string; item_name: string; uom_primary: string | null }[];
  resources: { resource_id: string; resource_code: string; resource_name: string }[];
  locations: { location_id: string; location_code: string; location_name: string; location_type: string; farm_id: string | null }[];
  departments: { cost_center_id: string; cost_center_code: string; cost_center_name: string }[];
}
export function emptyCommonRequisition(companyId: string, docType: CommonDocType, purpose: CommonPurpose, today: string): CommonRequisitionView;
export function emptyLine(): CommonRequisitionLine;
export function toRequisitionPayload(view: CommonRequisitionView): Record<string, unknown>;
export function isCommonEditable(view: CommonRequisitionView): boolean;
export type CommonAction = "save" | "submit" | "reopen" | "release" | "linkPo" | "ship" | "receive" | "openApproval";
export function commonActions(view: CommonRequisitionView, can: { create: boolean; approve: boolean; transfer: boolean }): CommonAction[];
```

- Produces (`common-requisition-document.tsx`): `CommonRequisitionDocument({ view, editable, options, onChange }: { view: CommonRequisitionView; editable: boolean; options?: CommonRequisitionOptions | null; onChange?: (next: CommonRequisitionView) => void })`.

- [ ] **Step 0: Measure the web baselines** (record in the task notes; they are the gates for Tasks 9–14): `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 2>&1 | tail -5` (suites/tests) and `cd apps/web && ../../node_modules/.bin/eslint . 2>&1 | tail -1` (error count).

- [ ] **Step 1: Failing model test** (`apps/web/specs/common-requisition-model.spec.ts`)

```ts
import { commonActions, emptyCommonRequisition, isCommonEditable, toRequisitionPayload } from "../src/components/console/requisitions/common-requisition-model";

const base = () => ({ ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "req-1", approval_status: "OPEN", document_status: "OPEN" });
const all = { create: true, approve: true, transfer: true };

describe("common requisition model", () => {
  it("starts a new document Open, dated today, with one empty line", () => {
    const v = emptyCommonRequisition("co-1", "FA", "PURCHASE", "2026-10-04");
    expect(v).toMatchObject({ company_id: "co-1", doc_type: "FA", purpose: "PURCHASE", requisition_date: "2026-10-04", direct_transfer: false });
    expect(v.lines).toHaveLength(1);
    expect(isCommonEditable(v)).toBe(true);
  });

  it("sends locations and to-ship targets only for Store, and numbers as numbers", () => {
    const v = { ...base(), from_location_id: "st", to_location_id: "sh", lines: [{ ...base().lines[0], item_id: "i1", quantity: "10", uom: "EA", qty_to_ship: "6" }] };
    expect(toRequisitionPayload(v)).toMatchObject({ company_id: "co-1", doc_type: "ITEM", purpose: "STORE", from_location_id: "st", to_location_id: "sh",
      lines: [{ item_id: "i1", quantity: 10, uom: "EA", qty_to_ship: 6 }] });
    const p = toRequisitionPayload({ ...v, purpose: "PURCHASE" }) as any;
    expect(p.from_location_id).toBeUndefined();
    expect(p.lines[0].qty_to_ship).toBeUndefined();
  });

  it.each([
    [{}, ["save", "submit"]],
    [{ approval_status: "PENDING_APPROVAL", approval_request_id: "ar-1" }, ["openApproval"]],
    [{ approval_status: "REJECTED", approval_request_id: "ar-1" }, ["reopen", "openApproval"]],
    [{ approval_status: "APPROVED", document_status: "APPROVED", approval_request_id: "ar-1" }, ["openApproval", "release"]],
    [{ approval_status: "APPROVED", document_status: "RELEASED", purpose: "PURCHASE", approval_request_id: "ar-1" }, ["openApproval", "linkPo"]],
  ])("offers the actions for %j", (over, actions) => {
    expect(commonActions({ ...base(), ...over } as any, all)).toEqual(actions);
  });

  it("offers ship while a line has balance to ship and receive while a shipment has something unreceived", () => {
    const v = { ...base(), approval_status: "APPROVED", document_status: "RELEASED", purpose: "STORE" as const,
      lines: [{ ...base().lines[0], line_id: "l1", balance_to_ship: 4 }],
      shipments: [{ shipment_id: "s1", shipment_no: "SH-2026-0001", shipment_date: "2026-10-04", lines: [{ requisition_line_id: "l1", shipped: 6, received: 2, remaining: 4 }] }] };
    expect(commonActions(v, all)).toEqual(["ship", "receive"]);
    expect(commonActions(v, { ...all, transfer: false })).toEqual([]);
  });

  it("offers nothing to a user without the grants", () => {
    expect(commonActions(base(), { create: false, approve: false, transfer: false })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 specs/common-requisition-model.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `common-requisition-model.ts`** with the interfaces above and:

```ts
export const emptyLine = (): CommonRequisitionLine => ({
  item_id: null, resource_id: null, description: null, quantity: "", uom: "", est_rate: null,
  from_location_id: null, to_location_id: null, qty_to_ship: null, qty_to_receive: null,
});

export function emptyCommonRequisition(companyId: string, docType: CommonDocType, purpose: CommonPurpose, today: string): CommonRequisitionView {
  return {
    company_id: companyId, doc_type: docType, purpose, requisition_date: today, required_date: null,
    main_location_id: null, requester_department_id: null, sender_department_id: null,
    from_location_id: null, to_location_id: null, direct_transfer: false, justification: null, remarks: null,
    lines: [emptyLine()],
  };
}

const n = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? undefined : Number(v));
const s = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? undefined : v);

/** The POST/PUT /requisition body — only the fields the API accepts; Purchase carries no locations or transfer targets. */
export function toRequisitionPayload(v: CommonRequisitionView): Record<string, unknown> {
  const store = v.purpose === "STORE";
  return {
    company_id: v.company_id,
    ...(s(v.farm_id ?? null) ? { farm_id: v.farm_id } : {}),
    doc_type: v.doc_type,
    purpose: v.purpose,
    requisition_date: s(v.requisition_date),
    main_location_id: s(v.main_location_id),
    requester_department_id: s(v.requester_department_id),
    sender_department_id: s(v.sender_department_id),
    from_location_id: store ? s(v.from_location_id) : undefined,
    to_location_id: store ? s(v.to_location_id) : undefined,
    direct_transfer: store && v.doc_type === "ITEM" ? v.direct_transfer : false,
    required_date: s(v.required_date),
    justification: s(v.justification),
    remarks: s(v.remarks),
    lines: v.lines.map((l) => ({
      item_id: v.doc_type === "ITEM" ? s(l.item_id) : undefined,
      resource_id: v.doc_type === "SERVICE" ? s(l.resource_id) : undefined,
      description: s(l.description),
      quantity: Number(l.quantity),
      uom: l.uom,
      est_rate: n(l.est_rate),
      from_location_id: store ? s(l.from_location_id) : undefined,
      to_location_id: store ? s(l.to_location_id) : undefined,
      qty_to_ship: store ? n(l.qty_to_ship) : undefined,
      qty_to_receive: store ? n(l.qty_to_receive) : undefined,
    })),
  };
}

/** Mirrors the API's assertEditable: a new document, or approval OPEN and document OPEN. */
export function isCommonEditable(v: CommonRequisitionView): boolean {
  if (!v.requisition_id) return true;
  return (v.approval_status ?? "OPEN") === "OPEN" && (v.document_status ?? "OPEN") === "OPEN";
}

export function commonActions(v: CommonRequisitionView, can: { create: boolean; approve: boolean; transfer: boolean }): CommonAction[] {
  if (!v.requisition_id) return can.create ? ["save"] : [];
  const approval = v.approval_status ?? "OPEN";
  const doc = v.document_status ?? "OPEN";
  const out: CommonAction[] = [];
  if (approval === "OPEN" && doc === "OPEN" && can.create) out.push("save", "submit");
  if (approval === "REJECTED" && can.create) out.push("reopen");
  if (v.approval_request_id && approval !== "OPEN") out.push("openApproval");
  if (approval === "APPROVED" && doc === "APPROVED" && can.approve) out.push("release");
  if (doc === "RELEASED" && v.purpose === "PURCHASE" && can.approve) out.push("linkPo");
  if (doc === "RELEASED" && v.purpose === "STORE" && can.transfer) {
    if (v.lines.some((l) => (l.balance_to_ship ?? 0) > 1e-9)) out.push("ship");
    if ((v.shipments ?? []).some((sh) => sh.lines.some((l) => l.remaining > 1e-9))) out.push("receive");
  }
  return out;
}
```

Note the `openApproval` order in the test table: for REJECTED it is `["reopen", "openApproval"]`, for APPROVED `["openApproval", "release"]` — matching the push order above. Run → PASS.

- [ ] **Step 4: Labels and strings.** In `requisition-labels.ts` add:

```ts
export const DOC_TYPE_LABEL: LabelMap = { FEED: "reqDocFeed", ITEM: "reqDocItem", FA: "reqDocFa", SERVICE: "reqDocService" };
export const COMMON_PURPOSE_LABEL: LabelMap = { STORE: "reqPurposeStore", PURCHASE: "reqPurposePurchase", INTERNAL_TRANSFER: "reqPurposeTransfer" };
export const APPROVAL_STATE_LABEL: LabelMap = {
  OPEN: { key: "reqApprovalOpen", variant: "neutral" }, PENDING_APPROVAL: { key: "reqStatusPending", variant: "warning" },
  APPROVED: { key: "reqStatusApproved", variant: "success" }, REJECTED: { key: "reqStatusRejected", variant: "danger" },
};
export const DOCUMENT_STATE_LABEL: LabelMap = {
  OPEN: { key: "reqDocumentOpen", variant: "neutral" }, APPROVED: { key: "reqStatusApproved", variant: "success" },
  RELEASED: { key: "reqDocumentReleased", variant: "info" }, CANCELLED: { key: "reqStatusCancelled", variant: "neutral" },
};
export const FULFILMENT_STATE_LABEL: LabelMap = {
  NOT_APPLICABLE: "reqFulfilmentNone", TRANSFER_OPEN: "reqFulfilmentOpen", PARTIALLY_SHIPPED: "reqFulfilmentPartShipped",
  SHIPPED: "reqFulfilmentShipped", PARTIALLY_RECEIVED: "reqFulfilmentPartReceived", RECEIVED: "reqFulfilmentReceived",
};
export const INTEGRATION_STATE_LABEL: LabelMap = { NOT_APPLICABLE: "reqIntegrationNone", BC_PENDING: "reqIntegrationBcPending" };
```

Add to the `en` dictionary (only `en`):

```ts
    reqDocFeed: "Feed", reqDocItem: "Item", reqDocFa: "Fixed Asset", reqDocService: "Service",
    reqPurposeStore: "Store", reqPurposePurchase: "Purchase",
    reqApprovalOpen: "Open", reqDocumentOpen: "Open", reqDocumentReleased: "Released",
    reqFulfilmentNone: "Not applicable", reqFulfilmentOpen: "Transfer open", reqFulfilmentPartShipped: "Partially shipped",
    reqFulfilmentShipped: "Shipped", reqFulfilmentPartReceived: "Partially received", reqFulfilmentReceived: "Received",
    reqIntegrationNone: "Not applicable", reqIntegrationBcPending: "Pending — Business Central not connected",
    crqHeaderTitle: "Requisition", crqLinesTitle: "Lines", crqLinesLabel: "Requisition lines",
    crqReqNo: "Requisition No.", crqReqDate: "Requisition date", crqType: "Type", crqPurpose: "Store or Purchase",
    crqMainLocation: "Main location", crqRequester: "Requester", crqRequesterDept: "Requester department", crqSenderDept: "Sender department",
    crqFrom: "From location", crqTo: "To location", crqDirectTransfer: "Direct transfer", crqRequiredDate: "Required date",
    crqJustification: "Justification", crqRemarks: "Remarks",
    crqApproval: "Approval", crqDocument: "Document", crqFulfilment: "Fulfilment", crqIntegration: "Integration",
    crqApprovedBy: "Approved by", crqApprovedAt: "Approved at", crqReleasedBy: "Released by", crqReleasedAt: "Released at",
    crqLinkedPo: "Linked PO No.", crqLinkedTransfer: "Linked transfer",
    crqColLine: "Line", crqColItem: "Item", crqColResource: "Resource", crqColDescription: "Description", crqColQty: "Quantity",
    crqColUom: "UOM", crqColRate: "Est. rate", crqColFrom: "From", crqColTo: "To", crqColToShip: "Qty to ship",
    crqColShipped: "Shipped", crqColBalance: "Balance to ship", crqColToReceive: "Qty to receive", crqColReceived: "Received",
    crqColRemaining: "Remaining to receive",
    crqChoose: "Choose…", crqAddLine: "Add line", crqRemoveLine: "Remove line {line}", crqYes: "Yes", crqNo: "No",
    crqItemFor: "Item, line {line}", crqResourceFor: "Resource, line {line}", crqDescriptionFor: "Description, line {line}",
    crqQtyFor: "Quantity, line {line}", crqUomFor: "UOM, line {line}", crqRateFor: "Est. rate, line {line}",
    crqToShipFor: "Qty to ship, line {line}", crqToReceiveFor: "Qty to receive, line {line}",
```

(Check the dictionary's interpolation syntax first — `grep -n "{line}\|{{line}}" apps/web/src/utils/translations.ts | head -3` — and match it.)

- [ ] **Step 5: Failing document test** (`apps/web/specs/common-requisition-document.spec.tsx`)

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommonRequisitionDocument } from "../src/components/console/requisitions/common-requisition-document";
import { emptyCommonRequisition } from "../src/components/console/requisitions/common-requisition-model";

jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "" }));

const options = {
  items: [{ item_id: "i1", item_code: "IT-1", item_name: "Fixture item", uom_primary: "EA" }],
  resources: [], departments: [],
  locations: [{ location_id: "st", location_code: "F1/STORE", location_name: "Store", location_type: "STORE", farm_id: "f1" },
              { location_id: "sh", location_code: "F1/SHED-1", location_name: "Shed", location_type: "SHED", farm_id: "f1" }],
};

describe("CommonRequisitionDocument", () => {
  it("edits the header and a line while Open, filling the item's UOM", () => {
    const onChange = jest.fn();
    const view = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04");
    render(<CommonRequisitionDocument view={view} editable options={options} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("crqFrom"), { target: { value: "st" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from_location_id: "st" }));
    fireEvent.change(screen.getByLabelText('crqItemFor:{"line":1}'), { target: { value: "i1" } });
    expect(onChange.mock.lastCall[0].lines[0]).toMatchObject({ item_id: "i1", uom: "EA" });
  });

  it("hides locations and transfer quantities on a Purchase document", () => {
    render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", "FA", "PURCHASE", "2026-10-04")} editable options={options} onChange={jest.fn()} />);
    expect(screen.queryByLabelText("crqFrom")).toBeNull();
    expect(screen.queryByText("crqColToShip")).toBeNull();
    expect(screen.getByLabelText('crqDescriptionFor:{"line":1}')).toBeTruthy();
  });

  it("is read-only after submission and shows shipped/received with derived balances", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "r", req_no: "REQ-2026-0001",
      approval_status: "APPROVED", document_status: "RELEASED", fulfilment_status: "PARTIALLY_RECEIVED", from_location_code: "F1/STORE",
      lines: [{ line_id: "l1", line_seq: 1, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
        quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_shipped: 6,
        qty_to_receive: "10", qty_received: 4, balance_to_ship: 4, remaining_to_receive: 6 }] };
    render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("REQ-2026-0001")).toBeTruthy();
    // header From and the line's From cell both show the code
    expect(screen.getAllByText("F1/STORE").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("crq-balance-1").textContent).toBe("4");
    expect(screen.getByTestId("crq-remaining-1").textContent).toBe("6");
  });
});
```

- [ ] **Step 6: Run** → FAIL. **Step 7: Implement `common-requisition-document.tsx`.** Structure (complete component; keep it presentational, the caller owns state):

```tsx
"use client";

/**
 * A common requisition (Item / Fixed Asset / Service) as a document — the same
 * layout as FeedRequisitionDocument (spec §6a): a header form and a lines
 * sub-form, editable while Open and read-only after. Field sources: the
 * "Field sources" table of docs/superpowers/plans/2026-10-04-feed-part-e-requisition.md;
 * est. rate and line description are ours. Store shows the from/to locations,
 * direct-transfer flag and the shipping quantities; Purchase does not.
 */
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, ReadField } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import {
  APPROVAL_STATE_LABEL, COMMON_PURPOSE_LABEL, DOC_TYPE_LABEL, DOCUMENT_STATE_LABEL, FULFILMENT_STATE_LABEL, INTEGRATION_STATE_LABEL, labelOf, variantOf,
} from "../inventory/requisition-labels";
import { emptyLine, type CommonRequisitionLine, type CommonRequisitionOptions, type CommonRequisitionView } from "./common-requisition-model";

const HALF = "sm:col-span-6";
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 align-top text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const qty = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 }));
const stamp = (v: string | null | undefined) => (v ? `${formatDateShort(v.slice(0, 10))} ${v.slice(11, 16)} UTC` : null);

export function CommonRequisitionDocument({ view, editable, options, onChange }: {
  view: CommonRequisitionView; editable: boolean; options?: CommonRequisitionOptions | null; onChange?: (next: CommonRequisitionView) => void;
}) {
  const { t } = useLanguage();
  const can = editable && !!onChange;
  const store = view.purpose === "STORE";
  const set = (patch: Partial<CommonRequisitionView>) => onChange?.({ ...view, ...patch });
  const setLine = (i: number, patch: Partial<CommonRequisitionLine>) =>
    onChange?.({ ...view, lines: view.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const locations = options?.locations ?? [];
  const departments = options?.departments ?? [];
  const items = options?.items ?? [];
  const resources = options?.resources ?? [];
  const locCode = (id: string | null, code?: string | null) => code ?? locations.find((l) => l.location_id === id)?.location_code ?? null;
  const deptName = (id: string | null, name?: string | null) => name ?? departments.find((d) => d.cost_center_id === id)?.cost_center_name ?? null;

  const select = (id: string, label: string, value: string | null, choices: { value: string; label: string }[], onPick: (v: string | null) => void) => (
    <Field className={HALF} label={label} htmlFor={id}>
      <select id={id} className="nf-input-sm nf-select" style={inputStyle} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
        <option value="">{t("crqChoose")}</option>
        {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    </Field>
  );
  const input = (id: string, label: string, value: string | null, type: string, onEdit: (v: string | null) => void) => (
    <Field className={HALF} label={label} htmlFor={id}>
      <input id={id} type={type} className="nf-input-sm" style={inputStyle} value={value ?? ""} onChange={(e) => onEdit(e.target.value || null)} />
    </Field>
  );
  const locChoices = locations.map((l) => ({ value: l.location_id, label: l.location_code }));
  const deptChoices = departments.map((d) => ({ value: d.cost_center_id, label: `${d.cost_center_code} — ${d.cost_center_name}` }));

  const columns = [
    "crqColLine", view.doc_type === "ITEM" ? "crqColItem" : view.doc_type === "SERVICE" ? "crqColResource" : null, "crqColDescription",
    "crqColQty", "crqColUom", "crqColRate",
    ...(store ? ["crqColFrom", "crqColTo", "crqColToShip", "crqColShipped", "crqColBalance", "crqColToReceive", "crqColReceived", "crqColRemaining"] : []),
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup title={t("crqHeaderTitle")}>
        <ReadField className={HALF} label={t("crqReqNo")} value={view.req_no ?? null} mono />
        <ReadField className={HALF} label={t("crqType")} value={labelOf(DOC_TYPE_LABEL, view.doc_type, t)} />
        {can && view.doc_type === "ITEM"
          ? select("crq-purpose", t("crqPurpose"), view.purpose, [{ value: "STORE", label: t("reqPurposeStore") }, { value: "PURCHASE", label: t("reqPurposePurchase") }],
              (v) => set({ purpose: (v ?? "PURCHASE") as CommonRequisitionView["purpose"] }))
          : <ReadField className={HALF} label={t("crqPurpose")} value={labelOf(COMMON_PURPOSE_LABEL, view.purpose, t)} />}
        {can ? input("crq-date", t("crqReqDate"), view.requisition_date, "date", (v) => set({ requisition_date: v }))
          : <ReadField className={HALF} label={t("crqReqDate")} value={view.requisition_date ? formatDateShort(view.requisition_date) : null} />}
        {can ? select("crq-main", t("crqMainLocation"), view.main_location_id, locChoices, (v) => set({ main_location_id: v }))
          : <ReadField className={HALF} label={t("crqMainLocation")} value={locCode(view.main_location_id, view.main_location_code)} mono />}
        <ReadField className={HALF} label={t("crqRequester")} value={view.requester_name ?? null} />
        {can ? select("crq-req-dept", t("crqRequesterDept"), view.requester_department_id, deptChoices, (v) => set({ requester_department_id: v }))
          : <ReadField className={HALF} label={t("crqRequesterDept")} value={deptName(view.requester_department_id, view.requester_department_name)} />}
        {can ? select("crq-snd-dept", t("crqSenderDept"), view.sender_department_id, deptChoices, (v) => set({ sender_department_id: v }))
          : <ReadField className={HALF} label={t("crqSenderDept")} value={deptName(view.sender_department_id, view.sender_department_name)} />}
        {store && (can ? select("crq-from", t("crqFrom"), view.from_location_id, locChoices, (v) => set({ from_location_id: v }))
          : <ReadField className={HALF} label={t("crqFrom")} value={locCode(view.from_location_id, view.from_location_code)} mono />)}
        {store && (can ? select("crq-to", t("crqTo"), view.to_location_id, locChoices, (v) => set({ to_location_id: v }))
          : <ReadField className={HALF} label={t("crqTo")} value={locCode(view.to_location_id, view.to_location_code)} mono />)}
        {store && view.doc_type === "ITEM" && (can ? (
          <Field className={HALF} label={t("crqDirectTransfer")} htmlFor="crq-direct">
            <input id="crq-direct" type="checkbox" checked={view.direct_transfer} onChange={(e) => set({ direct_transfer: e.target.checked })} />
          </Field>
        ) : <ReadField className={HALF} label={t("crqDirectTransfer")} value={view.direct_transfer ? t("crqYes") : t("crqNo")} />)}
        {can ? input("crq-required", t("crqRequiredDate"), view.required_date, "date", (v) => set({ required_date: v }))
          : <ReadField className={HALF} label={t("crqRequiredDate")} value={view.required_date ? formatDateShort(view.required_date) : null} />}
        <ReadField className={HALF} label={t("crqApproval")} value={view.approval_status ? <Badge variant={variantOf(APPROVAL_STATE_LABEL, view.approval_status)}>{labelOf(APPROVAL_STATE_LABEL, view.approval_status, t)}</Badge> : null} />
        <ReadField className={HALF} label={t("crqDocument")} value={view.document_status ? <Badge variant={variantOf(DOCUMENT_STATE_LABEL, view.document_status)}>{labelOf(DOCUMENT_STATE_LABEL, view.document_status, t)}</Badge> : null} />
        <ReadField className={HALF} label={t("crqFulfilment")} value={view.fulfilment_status ? labelOf(FULFILMENT_STATE_LABEL, view.fulfilment_status, t) : null} />
        <ReadField className={HALF} label={t("crqIntegration")} value={view.integration_status ? labelOf(INTEGRATION_STATE_LABEL, view.integration_status, t) : null} />
        <ReadField className={HALF} label={t("crqApprovedBy")} value={view.approved_by_name ?? null} />
        <ReadField className={HALF} label={t("crqApprovedAt")} value={stamp(view.approved_at)} />
        <ReadField className={HALF} label={t("crqReleasedBy")} value={view.released_by_name ?? null} />
        <ReadField className={HALF} label={t("crqReleasedAt")} value={stamp(view.released_at)} />
        {view.purpose === "PURCHASE" && <ReadField className={HALF} label={t("crqLinkedPo")} value={view.linked_po_no ?? null} mono />}
        {store && <ReadField className={HALF} label={t("crqLinkedTransfer")} value={view.linked_transfer_no ?? null} mono />}
        {can ? (
          <Field className="sm:col-span-12" label={t("crqJustification")} htmlFor="crq-justification">
            <textarea id="crq-justification" rows={2} className="nf-input w-full px-2 py-1" style={inputStyle} value={view.justification ?? ""} onChange={(e) => set({ justification: e.target.value || null })} />
          </Field>
        ) : <ReadField className="sm:col-span-12" label={t("crqJustification")} value={view.justification} />}
        {can ? (
          <Field className="sm:col-span-12" label={t("crqRemarks")} htmlFor="crq-remarks">
            <textarea id="crq-remarks" rows={2} className="nf-input w-full px-2 py-1" style={inputStyle} value={view.remarks ?? ""} onChange={(e) => set({ remarks: e.target.value || null })} />
          </Field>
        ) : <ReadField className="sm:col-span-12" label={t("crqRemarks")} value={view.remarks} />}
      </FieldGroup>

      <FieldGroup title={t("crqLinesTitle")}>
        <div className="sm:col-span-12 flex flex-col gap-2">
          <ScrollTable label={t("crqLinesLabel")}>
            <thead><tr>{columns.map((c) => <th key={c} scope="col" className={TH}>{t(c as any)}</th>)}{can && <th className={TH} />}</tr></thead>
            <tbody>
              {view.lines.map((line, i) => {
                const no = line.line_seq ?? i + 1;
                const cell = (key: string, value: string | null, onEdit: (v: string | null) => void, type = "text", width = "w-24") =>
                  can ? <input aria-label={t(key as any, { line: i + 1 })} type={type} className={cn("nf-input-sm", width, type === "number" && "text-right")} style={inputStyle}
                    value={value ?? ""} onChange={(e) => onEdit(e.target.value || null)} /> : (type === "number" ? qty(value) : value ?? "");
                return (
                  <tr key={line.line_id ?? `new-${i}`}>
                    <td className={cn(TD, NUM)}>{no}</td>
                    {view.doc_type === "ITEM" && (
                      <td className={TD}>{can ? (
                        <select aria-label={t("crqItemFor", { line: i + 1 })} className="nf-input-sm nf-select w-48" style={inputStyle} value={line.item_id ?? ""}
                          onChange={(e) => { const it = items.find((x) => x.item_id === e.target.value); setLine(i, { item_id: e.target.value || null, uom: it?.uom_primary ?? line.uom }); }}>
                          <option value="">{t("crqChoose")}</option>
                          {items.map((it) => <option key={it.item_id} value={it.item_id}>{it.item_code} — {it.item_name}</option>)}
                        </select>
                      ) : line.item_code ? `${line.item_code} — ${line.item_name ?? ""}` : ""}</td>
                    )}
                    {view.doc_type === "SERVICE" && (
                      <td className={TD}>{can ? (
                        <select aria-label={t("crqResourceFor", { line: i + 1 })} className="nf-input-sm nf-select w-48" style={inputStyle} value={line.resource_id ?? ""}
                          onChange={(e) => setLine(i, { resource_id: e.target.value || null })}>
                          <option value="">{t("crqChoose")}</option>
                          {resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_code} — {r.resource_name}</option>)}
                        </select>
                      ) : line.resource_code ? `${line.resource_code} — ${line.resource_name ?? ""}` : ""}</td>
                    )}
                    <td className={TD}>{cell("crqDescriptionFor", line.description, (v) => setLine(i, { description: v }), "text", "w-48")}</td>
                    <td className={cn(TD, NUM)}>{cell("crqQtyFor", line.quantity, (v) => setLine(i, { quantity: v ?? "" }), "number")}</td>
                    <td className={TD}>{cell("crqUomFor", line.uom, (v) => setLine(i, { uom: v ?? "" }), "text", "w-16")}</td>
                    <td className={cn(TD, NUM)}>{cell("crqRateFor", line.est_rate, (v) => setLine(i, { est_rate: v }), "number")}</td>
                    {store && <>
                      <td className={TD}>{locCode(line.from_location_id, line.from_location_code) ?? ""}</td>
                      <td className={TD}>{locCode(line.to_location_id, line.to_location_code) ?? ""}</td>
                      <td className={cn(TD, NUM)}>{cell("crqToShipFor", line.qty_to_ship, (v) => setLine(i, { qty_to_ship: v }), "number")}</td>
                      <td className={cn(TD, NUM)}>{qty(line.qty_shipped)}</td>
                      <td className={cn(TD, NUM)} data-testid={`crq-balance-${no}`}>{qty(line.balance_to_ship)}</td>
                      <td className={cn(TD, NUM)}>{cell("crqToReceiveFor", line.qty_to_receive, (v) => setLine(i, { qty_to_receive: v }), "number")}</td>
                      <td className={cn(TD, NUM)}>{qty(line.qty_received)}</td>
                      <td className={cn(TD, NUM)} data-testid={`crq-remaining-${no}`}>{qty(line.remaining_to_receive)}</td>
                    </>}
                    {can && (
                      <td className={TD}>
                        <Button variant="ghost" size="sm" aria-label={t("crqRemoveLine", { line: i + 1 })} disabled={view.lines.length === 1}
                          onClick={() => onChange?.({ ...view, lines: view.lines.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </ScrollTable>
          {can && <div><Button variant="outline" size="sm" onClick={() => onChange?.({ ...view, lines: [...view.lines, emptyLine()] })}><Plus className="h-3.5 w-3.5" /> {t("crqAddLine")}</Button></div>}
        </div>
      </FieldGroup>
    </div>
  );
}
```

Line from/to stay the header's (they default to it in the API, `lineValues`); the sub-form shows them read-only, so Review Focus 5 cannot be produced from this UI — it remains an API guard.

- [ ] **Step 8: Run** `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 specs/common-requisition-model.spec.ts specs/common-requisition-document.spec.tsx specs/requisition-labels.spec.ts && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json` → PASS, 0. Lint: no new errors over Step 0.

- [ ] **Step 9: Commit** — `feat(requisition-web): the common requisition as a document — header form and lines sub-form` (body: the same layout as the feed document, spec §6a; field sources table in the plan; est. rate and description labelled ours; not yet mounted anywhere — the screen appears with Task 13).

---

### Task 10: Web — New offers Feed, Item, Fixed Asset and Service

**Files:**
- Modify: `apps/web/src/components/console/inventory/requisition-new-dialog.tsx`, `apps/web/src/utils/translations.ts`
- Test: `apps/web/specs/requisition-new-dialog.spec.tsx`

**Interfaces:**
- Consumes: Task 8 (`exception_reason` on manual lines); `useFeedFarm()` and `FeedFarmSelect` (`./use-feed-farm`, `./feed-farm-select`).
- Produces: `RequisitionNewDialog({ open, farmId?, types = ["FEED"], onClose, onCreated, onCommon? })` where `types: Array<"FEED" | "ITEM" | "FA" | "SERVICE">` and `onCommon?: (choice: { docType: "ITEM" | "FA" | "SERVICE"; purpose: "STORE" | "PURCHASE" }) => void`. Item asks Store or Purchase; FA and Service call `onCommon` with `PURCHASE` directly (decisions 1 Oct). Feed without `farmId` shows a farm select. Each feed line has an optional exception-reason input sent as `exception_reason`.

- [ ] **Step 1: Failing tests** (append to `requisition-new-dialog.spec.tsx`; the existing two tests stay — they render with the default `types`)

```tsx
describe('RequisitionNewDialog — every requisition type (spec §6a)', () => {
  it('offers Item, Fixed Asset and Service when asked; Item chooses Store or Purchase; FA and Service go straight to Purchase', () => {
    const onCommon = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" types={['FEED', 'ITEM', 'FA', 'SERVICE']} onClose={jest.fn()} onCreated={jest.fn()} onCommon={onCommon} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFa' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'FA', purpose: 'PURCHASE' });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeService' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'SERVICE', purpose: 'PURCHASE' });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeItem' }));
    expect(onCommon).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewItemStore' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'ITEM', purpose: 'STORE' });
  });

  it('offers only Feed on the Feed Forecast tab (default types)', () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'rqNewPurposeItem' })).toBeNull();
  });

  it('sends a line exception reason (Req. row 13)', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    await waitFor(() => expect((screen.getByLabelText('rqNewDestination:{"line":1}') as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(screen.getByLabelText('rqNewDestination:{"line":1}'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":1}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.change(screen.getByLabelText('rqNewException:{"line":1}'), { target: { value: 'Vet instruction' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition', expect.objectContaining({
      lines: [expect.objectContaining({ exception_reason: 'Vet instruction' })],
    })));
  });
});
```

Also update the first existing test's expected POST body: the exception field is omitted when blank, so it stays unchanged — keep that behaviour (`...(l.reason.trim() ? { exception_reason: l.reason.trim() } : {})`).

- [ ] **Step 2: Run** `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 specs/requisition-new-dialog.spec.tsx` → the three new tests FAIL.

- [ ] **Step 3: Implement.** Changes to `requisition-new-dialog.tsx`:
  - `Draft` gains `reason: string`; `EMPTY` gets `reason: ""`.
  - Props as in Interfaces; `purpose` state becomes `const [step, setStep] = useState<"choose" | "item" | "FEED">("choose")`; reset to `"choose"` on open.
  - The chooser renders one button per entry of `types` using a small table:

```tsx
const CHOICES = {
  FEED: { label: "rqNewPurposeFeed", hint: "rqNewPurposeFeedHint", icon: Wheat },
  ITEM: { label: "rqNewPurposeItem", hint: "rqNewPurposeItemHint", icon: Package },
  FA: { label: "rqNewPurposeFa", hint: "rqNewPurposeFaHint", icon: Building2 },
  SERVICE: { label: "rqNewPurposeService", hint: "rqNewPurposeServiceHint", icon: Wrench },
} as const;
const pick = (type: keyof typeof CHOICES) => {
  if (type === "FEED") return setStep("FEED");
  if (type === "ITEM") return setStep("item");
  onCommon?.({ docType: type, purpose: "PURCHASE" }); // decisions 1 Oct: FA and Service use Purchase
};
```

  each button keeps the existing markup (the `nf-press` card), with `aria-label={t(CHOICES[type].label)}`. Step `"item"` renders two such buttons, `rqNewItemStore` / `rqNewItemPurchase`, calling `onCommon?.({ docType: "ITEM", purpose: "STORE" | "PURCHASE" })`.
  - Feed step: when `farmId` prop is absent, render above the lines `const farm = useFeedFarm();` + `<FeedFarmSelect id="rqn-farm" label={t("rqFarm")} farms={farm.farms} farmId={farm.farmId} onChange={farm.setFarmId} />`, and use `const effectiveFarmId = farmId ?? farm.farmId` for the options fetch and the POST body. Call `useFeedFarm()` unconditionally at the top of the component (hooks rule); it is cheap and cached.
  - Each feed line row gets a fifth field:

```tsx
<Field label={t("rqNewException", { line: i + 1 })} htmlFor={`rqn-exc-${i}`} hint={t("rqNewExceptionHint")}>
  <input id={`rqn-exc-${i}`} className="nf-input-sm" style={inputStyle} maxLength={180} value={line.reason} onChange={(e) => setLine(i, { reason: e.target.value })} />
</Field>
```

  (widen the row grid to `sm:grid-cols-[1fr_1fr_7rem_9rem_1fr_auto]`).
  - POST body line: `{ destination_location_id: l.dest, item_id: l.item, quantity_kg: Number(l.kg), proposed_delivery_date: l.date, ...(l.reason.trim() ? { exception_reason: l.reason.trim() } : {}) }`.
  - The dialog title: `t(step === "choose" || step === "item" ? "rqNew" : "rqNewTitle")`.

  `en` strings: `rqNewPurposeItem: "Item"`, `rqNewPurposeItemHint: "Request stock items from a store or to buy."`, `rqNewPurposeFa: "Fixed Asset"`, `rqNewPurposeFaHint: "Request a fixed asset to be bought."`, `rqNewPurposeService: "Service"`, `rqNewPurposeServiceHint: "Request a service to be bought."`, `rqNewItemStore: "Store — transfer from a store"`, `rqNewItemPurchase: "Purchase — buy it"`, `rqNewException: "Exception reason, line {line}"`, `rqNewExceptionHint: "Required when the item differs from the lifecycle requirement (Requisition row 13)."`. Icons `Package`, `Building2`, `Wrench` from `lucide-react`.

- [ ] **Step 4: Run** the dialog spec + `specs/requisitions-panel.spec.tsx` + web `tsc` → PASS, 0. Lint: no new errors.

- [ ] **Step 5: Commit** — `feat(requisition-web): New offers Feed, Item, Fixed Asset and Service` (quote §6a "New offers Feed, Item, Fixed Asset and Service. Item chooses Store or Purchase; Fixed Asset and Service use Purchase (1 Oct ruling)"; feed lines carry the row-13 exception reason; farm chosen on the header when the caller has none).

---

### Task 11: Web — one feed document component for both entry points

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-requisition-detail.tsx`
- Modify: `apps/web/src/components/console/inventory/requisitions-panel.tsx`
- Test: `apps/web/specs/feed-requisition-detail.spec.tsx`; existing `specs/requisitions-panel.spec.tsx` must pass unchanged

**Interfaces:**
- Consumes: `FeedRequisitionDocument`, `needsRemarks`, `remarksRequiredMessage`, `isLineExceptioned`, `requestedKgOf` (existing exports).
- Produces: `FeedRequisitionDetail({ view, onView, onBack }: { view: RequisitionView; onView: (next: RequisitionView, notice?: string) => void; onBack: () => void })` — owns edits, remarks, options (`GET /feed-requisition/options?farmId=<view.farm_id>`), Save (`PUT /feed-requisition/:id`), Submit (`POST /feed-requisition/:id/submit`), the approval link, error/notice display. `RequisitionView` gains `farm_id?: string | null` (the API's `readView` already spreads `...row.req`).

- [ ] **Step 1: Failing test** (`feed-requisition-detail.spec.tsx`): copy the `view` fixture and mocks from `requisitions-panel.spec.tsx` (add `farm_id: 'farm-vil'`), render `<FeedRequisitionDetail view={view} onView={onView} onBack={jest.fn()} />`, assert (a) `get` called with `/feed-requisition/options?farmId=farm-vil`, (b) changing the line-1 quantity input to `6100` and clicking `rqSave` calls `put('/feed-requisition/req-1', { remarks: '', lines: [{ line_id: 'L1', quantity_kg: 6100 }] })` and then `onView` with the response, (c) with `status: 'APPROVED'` no `rqSave`/`rqSubmit` buttons render. Use the exact quantity input label the panel spec already uses for line edits (read it from that spec; do not guess the key).
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** — move, without behaviour change, from `FeedRequisitionPanel` into `FeedRequisitionDetail`: `edits`, `remarks`, `options` state; `editLine`, `lineEdits`, `editable`, `deviating`/`moved`/`exceptioned`/`late`, `remarksError`, `href`; the options effect (keyed on `view.requisition_id`, `editable`, `view.farm_id`); `save` and `submit`; the JSX between `selected ? (` and the list (back button + heading, document, action row). `isEditable` and `approvalHref` move with it (export them from the new file; re-export from `requisitions-panel.tsx` if any spec imports them from there — check `grep -rn "isEditable\|approvalHref" apps/web/specs`). The panel keeps the list, filters, Draft from forecast, New and renders `<FeedRequisitionDetail view={selected} onView={(v, notice) => { setSelected(v); if (notice) setNotice(notice); loadList(); }} onBack={() => setSelected(null)} />`. Errors inside the detail render with its own `InlineAlert`.
- [ ] **Step 4: Run** `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 specs/feed-requisition-detail.spec.tsx specs/requisitions-panel.spec.tsx specs/feed-forecast-tabs.spec.tsx specs/feed-requisition-document.spec.tsx` + web `tsc` → PASS, 0. If a panel test fails, the move changed behaviour — fix the move, not the test.
- [ ] **Step 5: Commit** — `refactor(feed-web): FeedRequisitionDetail — one feed document for both entry points` (spec §6a "Both produce the identical document").

---

### Task 12: Web — the common document's actions

**Files:**
- Create: `apps/web/src/components/console/requisitions/common-requisition-detail.tsx`
- Modify: `apps/web/src/utils/translations.ts`
- Test: `apps/web/specs/common-requisition-detail.spec.tsx`

**Interfaces:**
- Consumes: Task 9 model and document; API `POST /requisition`, `PUT /requisition/:id`, `POST /requisition/:id/submit|reopen|release|link-po|shipment|receipt`, `GET /requisition/options`; `hasPermission(getStoredUser(), …)` from `@/hooks/useAuth`.
- Produces: `CommonRequisitionDetail({ initial, onView, onBack }: { initial: CommonRequisitionView; onView: (next: CommonRequisitionView, notice?: string) => void; onBack: () => void })`.

Behaviour:
- `can = { create: hasPermission(u, "PROCUREMENT", "REQUISITION", "can_create"), approve: hasPermission(u, "PROCUREMENT", "REQUISITION", "can_approve"), transfer: hasPermission(u, "INVENTORY", "STOCK_TRANSFER", "can_edit") }`; buttons = `commonActions(draft, can)`.
- **save**: new → `POST /requisition` with `toRequisitionPayload(draft)`; existing → `PUT /requisition/:id`. Notice `crqSaved`.
- **submit**: `PUT` then `POST /requisition/:id/submit` (`{}`), so unsaved edits are never lost. Notice `crqSubmitted`.
- **reopen** `POST …/reopen`; **release** `POST …/release` (notice `crqReleasedStore` for Store — "Released. Transfer {no} is open for shipment." — or `crqReleasedPurchase` — "Released. Business Central is not connected; the purchase is pending.").
- **linkPo**: inline `Field` `crqPoNo` + button → `POST …/link-po { linked_po_no }`.
- **ship**: a panel listing each line with `balance_to_ship > 0`: `Field` `crqShipQtyFor` (number, `max = balance_to_ship`) and one `crqPostingDate` date (default today) → `POST …/shipment { posting_date, lines: [{ line_id, quantity }] }` for lines with a positive entry.
- **receive**: `select` `crqShipment` (shipments with remaining > 0) then per line of that shipment with `remaining > 0` a qty field (`max = remaining`) → `POST …/receipt { posting_date, shipment_id, lines }`.
- **openApproval**: link `/approvals/{pending|approved|rejected}?request=<approval_request_id>` (same mapping as the feed panel's `approvalHref`, keyed on `approval_status`).
- API errors are shown as they come (`InlineAlert`). The draft is local state; `onView` receives every server response.

- [ ] **Step 1: Failing test** (`common-requisition-detail.spec.tsx`) — mock `api` (`get`, `post`, `put`), `useLanguage` (stableT as elsewhere), and `@/hooks/useAuth` (`getStoredUser: () => ({})`, `hasPermission: () => true`). Cases:
  1. New Item/Store draft: fill `crqFrom`, `crqTo`, line item/qty via the document's labels; click `crqSave` → `post('/requisition', expect.objectContaining({ doc_type: 'ITEM', purpose: 'STORE', from_location_id: 'st', to_location_id: 'sh' }))`; `onView` called with the response.
  2. Existing Open draft: click `crqSubmit` → `put` called **before** `post('/requisition/req-1/submit', {})` (assert with `mock.invocationCallOrder`).
  3. Released Store with one line `balance_to_ship: 4`: click `crqShip`, type `3` into `crqShipQtyFor:{"line":1}`, click `crqPostShipment` → `post('/requisition/req-1/shipment', { posting_date: <today ISO>, lines: [{ line_id: 'l1', quantity: 3 }] })`; typing `5` disables `crqPostShipment` (over-shipment caught before the click; the API refuses it too).
  4. Released Store with a shipment `remaining: 4`: choose it in `crqShipment`, type `4`, click `crqPostReceipt` → `post('/requisition/req-1/receipt', { posting_date: <today>, shipment_id: 's1', lines: [{ line_id: 'l1', quantity: 4 }] })`.
  5. Released Purchase: type a PO number into `crqPoNo`, click `crqLinkPo` → `post('/requisition/req-1/link-po', { linked_po_no: 'PO-TEST-1' })`.
  6. API refusal on release (`post` rejects `{ message: 'A requisition must be approved before it can be released; approval never implies release.' }`) → that text is on screen.
  (Use `todayIso()` from `../src/components/console/inventory/feed-format` in the test for the date.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the behaviour list, using `Field`, `Button`, `InlineAlert`, and `CommonRequisitionDocument` with `editable={isCommonEditable(draft)}` and `options` loaded once from `GET /requisition/options?company_id=<draft.company_id>${draft.farm_id ? `&farm_id=${draft.farm_id}` : ""}` (only while editable). Add `en` strings: `crqSave: "Save"`, `crqSubmit: "Submit for approval"`, `crqReopen: "Reopen"`, `crqRelease: "Release"`, `crqLinkPo: "Link PO"`, `crqPoNo: "PO No."`, `crqShip: "Ship…"`, `crqReceive: "Receive…"`, `crqPostShipment: "Post shipment"`, `crqPostReceipt: "Post receipt"`, `crqPostingDate: "Posting date"`, `crqShipment: "Shipment"`, `crqShipQtyFor: "Ship now, line {line}"`, `crqReceiveQtyFor: "Receive now, line {line}"`, `crqOpenApproval: "Open the approval"`, `crqBack: "Back"`, `crqSaved: "Saved."`, `crqSubmitted: "Submitted for approval."`, `crqReopened: "Reopened for correction."`, `crqReleasedStore: "Released. Transfer {no} is open for shipment."`, `crqReleasedPurchase: "Released. Business Central is not connected; the purchase is pending."`, `crqPoLinked: "PO number linked."`, `crqShipped: "Shipment posted."`, `crqReceived: "Receipt posted."`, `crqActionFailed: "The action failed."`.
- [ ] **Step 4: Run** the detail spec + Task 9 specs + web `tsc` → PASS, 0; lint no new errors.
- [ ] **Step 5: Commit** — `feat(requisition-web): Save, Submit, Reopen, Release, Link PO, Ship and Receive on the common document` (quote decisions 1 Oct "Approval precedes Release"; Approve/Reject stay in the Approvals inbox; still not mounted — Task 13).

---

### Task 13: Web — Approvals → Requisitions lists and creates every type

**Files:**
- Create: `apps/web/src/components/console/requisitions/requisitions-hub.tsx`
- Modify: `apps/web/src/app/(app)/approvals/requisitions/page.tsx`, `apps/web/src/utils/translations.ts`
- Test: `apps/web/specs/requisitions-hub.spec.tsx`, `apps/web/specs/requisition-navigation.spec.ts`

**Interfaces:**
- Consumes: `GET /requisition?doc_type=&status=` (Task 1), `GET /requisition/:id`, `GET /feed-requisition/:id`; `RequisitionNewDialog` (Task 10), `FeedRequisitionDetail` (Task 11), `CommonRequisitionDetail` (Task 12), `emptyCommonRequisition`; `getActiveCompanyId()` from `@/hooks/useAuth`; `todayIso()` from `../inventory/feed-format`.
- Produces: `RequisitionsHub()` (default export too).

Behaviour:
- Filters: Type (`""` all, FEED, ITEM, FA, SERVICE — labels `DOC_TYPE_LABEL`), Status (legacy `status`: DRAFT, AUTO_DRAFT, PENDING_APPROVAL, APPROVED, REJECTED). List columns: Req. No., Type, Purpose (`COMMON_PURPOSE_LABEL`), Farm (`farm_code`), Date (`requisition_date`), Required (`required_date`), Approval, Document, Fulfilment (badges via Task 9 labels), Lines. One `ScrollTable`.
- Open a row: FEED → `GET /feed-requisition/:id` → `FeedRequisitionDetail`; else `GET /requisition/:id` → `CommonRequisitionDetail`.
- `?id=` on load: `GET /requisition/:id` to learn `doc_type`, then as above (the inbox's feed link and the old `/inventory/requisitions?id=` redirect land here).
- New: `RequisitionNewDialog` with `types={["FEED","ITEM","FA","SERVICE"]}`, no `farmId` (Feed chooses its farm), `onCreated` → feed detail, `onCommon` → `CommonRequisitionDetail initial={emptyCommonRequisition(companyId, docType, purpose, todayIso())}`. Without an active company (`getActiveCompanyId()` null — tenant-wide workspace) Item/FA/Service show `InlineAlert` `rhNeedsCompany` ("Choose a company in the workspace switcher to raise an Item, Fixed Asset or Service requisition.") instead of opening the document.
- After any `onView`, reload the list.

- [ ] **Step 1: Failing tests** (`requisitions-hub.spec.tsx`; mock `api`, `useLanguage`, `@/hooks/useAuth` with `getActiveCompanyId: () => 'co-1'`, `getStoredUser`, `hasPermission: () => true`, and `../src/components/console/inventory/use-feed-farm`):
  1. Lists rows of every type from `GET /requisition` (fixture rows: one FEED, one ITEM/STORE, one FA, one SERVICE) and shows `reqDocFeed`, `reqDocItem`, `reqDocFa`, `reqDocService`.
  2. Choosing Type `ITEM` re-requests `/requisition?doc_type=ITEM`.
  3. Clicking the FEED row calls `GET /feed-requisition/<id>` and renders the feed document heading; clicking the ITEM row calls `GET /requisition/<id>` and renders `crqHeaderTitle`.
  4. `window.history.replaceState({}, '', '/approvals/requisitions?id=req-feed')` before render → `GET /requisition/req-feed` then `GET /feed-requisition/req-feed`.
  5. New → `rqNewPurposeFa` → the common document opens with type `reqDocFa` and purpose `reqPurposePurchase`, no POST yet.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the hub; swap the page:

```tsx
// apps/web/src/app/(app)/approvals/requisitions/page.tsx — replace the import and the element
import RequisitionsHub from "@/components/console/requisitions/requisitions-hub";
// …
      <RequisitionsHub />
```

and add to `requisition-navigation.spec.ts`:

```ts
  it('Approvals -> Requisitions is the all-types hub, not the feed-only panel (spec §6a)', () => {
    const page = read('src/app/(app)/approvals/requisitions/page.tsx');
    expect(page).toContain('RequisitionsHub');
    expect(page).not.toContain('requisitions-panel');
  });
```

No navigation entry changes: the route and its nav item already exist; the Feed Forecast tab keeps `FeedRequisitionPanel`. Add `en` strings for the hub's filter labels and columns (`rhType`, `rhStatus`, `rhAll`, `rhColReqNo`, `rhColType`, `rhColPurpose`, `rhColFarm`, `rhColDate`, `rhColRequired`, `rhColApproval`, `rhColDocument`, `rhColFulfilment`, `rhColLines`, `rhNone: "No requisitions."`, `rhLoading: "Loading requisitions…"`, `rhNeedsCompany` as above, `rhNew: "New"`).
- [ ] **Step 4: Run** `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 specs/requisitions-hub.spec.tsx specs/requisition-navigation.spec.ts specs/nav-scope-consistency.spec.ts specs/role-permissions-coverage.spec.ts` + web `tsc` → PASS, 0; lint no new errors.
- [ ] **Step 5: Commit** — `feat(requisition-web): Approvals -> Requisitions lists and creates every type` (quote §6a "Approvals → Requisitions lists all types with a type filter. New offers Feed, Item, Fixed Asset and Service"; until this commit the page rendered the feed-only panel).

---

### Task 14: Web — the Approvals inbox shows both documents read-only

**Files:**
- Modify: `apps/web/src/components/console/approvals/feed-requisition-approval-detail.tsx`, `requisition-approval-detail.tsx`
- Test: `apps/web/specs/feed-requisition-approval-detail.spec.tsx`, `apps/web/specs/requisition-approval-detail.spec.tsx`

**Interfaces:**
- Consumes: `FeedRequisitionDocument` (`editable={false}`), `CommonRequisitionDocument` (`editable={false}`); props of both detail components stay as they are (the shell is unchanged).

- [ ] **Step 1: Update the specs first (failing).** Feed: with the existing `GET /feed-requisition/:id` mock returning a full document view (reuse the `view` fixture of `requisitions-panel.spec.tsx`), assert the document header `rqdHeaderTitle` and line `10000` render, no `combobox`/`spinbutton` inside the document, the approver-remarks textarea still renders while `pending`, and the open link still targets `/approvals/requisitions?id=<id>`. Common: with the existing view fixture, assert `crqHeaderTitle` renders, `REQ-2026-0001` shows, and no `combobox`/`textbox` exists.
- [ ] **Step 2: Run** both specs → FAIL.
- [ ] **Step 3: Implement.** Feed detail: keep the fetch; store the whole view; render `<FeedRequisitionDocument view={view} editable={false} />` in place of the hand-built table and farm-remarks line; keep the approver remarks `Field` and the link. Common detail: render `<CommonRequisitionDocument view={view} editable={false} />` in place of the grid and table; keep the unavailable message. Remove translation keys that become unused only if `grep -rn "<key>" apps/web/src apps/web/specs` finds no other use.
- [ ] **Step 4: Run** both specs + `specs/feed-requisition-document.spec.tsx` + web `tsc` → PASS, 0; lint no new errors.
- [ ] **Step 5: Commit** — `feat(approvals-web): the inbox shows feed and common requisitions as their documents` (§6a "Approvals inbox — one inbox for every type"; the approver saw a five-column table, not the document the farm submitted).

---

### Task 15: Verify Part E in the running app and MySQL

**Files:**
- Create: `docs/VERIFICATION-<completion date>-feed-part-e.md`
- Modify: `AGENTS.md` §8 "What exists now" (common requisition screens, two feed entry points, staged transfer posts once, 0147, the 0146 `when` rule)

- [ ] **Step 1: Full gates, from the worktree tools (never nx).** `cd apps/api && npx jest --maxWorkers=2 2>&1 | tail -5`; `cd apps/api && npx tsc --noEmit -p tsconfig.app.json`; `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2 2>&1 | tail -5`; `cd apps/web && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json`; `cd apps/web && ../../node_modules/.bin/eslint . 2>&1 | tail -1` vs Task 9 Step 0. Record exact counts. A failure goes back to the task that owns it.
- [ ] **Step 2: Rebuild and restart.** API: Global Constraints webpack command; `grep -c "transferShipmentRate" apps/api/dist/main.js` ≥ 1 and `grep -c "requiredItemForManualLine" apps/api/dist/main.js` ≥ 1; `lsof -ti :2877` → `kill <pid>`; `cd apps/api && node --env-file-if-exists=.env dist/main.js` in the background; note the PID. Web: if `lsof -ti :3002` shows a `next dev` started from this worktree's `apps/web`, keep it; otherwise start `cd apps/web && ../../node_modules/.bin/next dev --port 3002`. Check memory (`top -l 1 -n 0 | grep PhysMem`) before starting anything.
- [ ] **Step 3: Two users.** Creator: the seed dev COMPANY_ADMIN (`apps/api/src/scripts/seed-dev-tenant.ts`). Approver: a different user with PROCUREMENT/REQUISITION approve in the same company (the OPERATIONAL_ADMIN in `user_master`, or any admin type other than the creator). Find them with `select user_id, email, user_type from user_master where deleted_at is null;` — do not write credentials into the report. If no second approver can log in, stop and ask Rishi for one; do not create users.
- [ ] **Step 4: Drive each document in the browser at `http://localhost:3002/approvals/requisitions`** (creator), then approve as the approver in the Approvals inbox, then continue as the creator:
  1. **Item / Store** — from a STORE holding a non-feed item (query in Task 4 Step 1) to another location; 2 units, qty to ship 2. Save → Submit → (approver) Approve → Release → Ship 1 → Receive 1 (partial) → Ship 1 → Receive 1.
  2. **Item / Purchase** — any active item, 1 unit. Save → Submit → Approve → Release → Link PO (a number the report labels as a test value).
  3. **Fixed Asset** — description only, 1 unit. Save → Submit → Approve → Release.
  4. **Service** — a Resource if `resource_master` has one for the company, else a description. Save → Submit → Approve → Release.
  5. **Feed (manual) from Approvals → New → Feed** — choose a farm with a forecast demand; one line to a silo with the demanded item; one line (or a second requisition) with a different feed item: Create without a reason (expect the row-13 refusal on screen), then with a reason (accepted). Submit with remarks → (approver) Approve. Confirm it does **not** offer Release (feed stops at Approved).
  6. **Feed (manual) from Feed Forecast → Feed Requisition → New** — confirm the same dialog and the same document open.
  7. **Self-approval** — as the creator, call `POST /api/v1/requisition/<item-store id>/approve` while it is pending (before step 1's approval) and record the 403 message.
  8. **Edit after submit** — `PUT /api/v1/requisition/<id>` on a pending document; record the 400.
- [ ] **Step 5: Read every row back.** For each requisition number from Step 4:

```sql
select req_no, doc_type, purpose, source, status, approval_status, document_status, fulfilment_status, integration_status,
       requester_name, approved_by, approved_at, released_by, released_at, linked_po_no, linked_transfer_id
from requisition where req_no in (<numbers>);
select r.req_no, l.line_seq, l.item_id, l.resource_id, l.description, l.quantity, l.uom, l.qty_to_ship, l.qty_shipped, l.qty_to_receive, l.qty_received
from requisition_line l join requisition r using (requisition_id) where r.req_no in (<numbers>) order by r.req_no, l.line_seq;
select t.transfer_no, t.status, tl.line_no, tl.quantity, tl.requisition_line_id from stock_transfer t join stock_transfer_line tl using (transfer_id)
where t.transfer_id = (select linked_transfer_id from requisition where req_no = '<item-store no>');
select s.shipment_no, sl.quantity, rc.receipt_no, rl.quantity from transfer_shipment s join transfer_shipment_line sl using (shipment_id)
left join transfer_receipt_line rl on rl.shipment_line_id = sl.shipment_line_id left join transfer_receipt rc on rc.receipt_id = rl.receipt_id
where s.transfer_id = (select linked_transfer_id from requisition where req_no = '<item-store no>');
select transaction_type, warehouse_id, quantity, amount, document_no from inventory_ledger
where document_type = 'STOCK_TRANSFER' and document_line_id in (select line_id from stock_transfer_line where transfer_id = (select linked_transfer_id from requisition where req_no = '<item-store no>'))
order by created_at;
select request_id, document_type, status, requested_by, approved_by from approval_request where document_id in (select requisition_id from requisition where req_no in (<numbers>));
```

Expected and to be checked by hand: Store — after ship 1 / receive 1 the line reads shipped 1, received 1, fulfilment `PARTIALLY_RECEIVED`; after the second pair `RECEIVED`; the ledger has exactly two `TRANSFER_SHIPMENT` −1 rows at the source and two `TRANSFER_RECEIPT` +1 rows at the destination, receipt amount = shipment amount. Purchase — `integration_status BC_PENDING`, `fulfilment_status NOT_APPLICABLE`, `linked_po_no` set. FA/Service — released, `BC_PENDING`. Every common row `source = MANUAL_ENTRY`, `approved_by` ≠ creator. Feed — `doc_type FEED`, `source MANUAL_ENTRY`, the exception line's `description` begins `Exception: `, status `APPROVED`, no `released_at`.
- [ ] **Step 6: Screens.** Screenshot (browser pane) the hub list with all four types and the filter set, each document in its final state, the inbox detail of one feed and one common requisition, and the row-13 refusal.
- [ ] **Step 7: Write the report** `docs/VERIFICATION-<date>-feed-part-e.md`: commit range, gate counts, PIDs and bundle checks, each Step 4 action with its outcome, the SQL output, screenshots, what did not match (with the task that owns it), and open items: Direct Transfer has no explicit permission key and no UI (1 Oct plan Task 11 never bound one); `loadDraftTransfers` counts a partially staged DRAFT transfer in full (Part B); common requisitions still number `REQ-YYYY-NNNN` in code rather than a company Number Series (decisions 1 Oct "Common Purchase and Feed Requisitions use separate company-owned Number Series"); `nf_devco` has no `DEPARTMENT` cost centres, so the department selects are empty until Triple C's are entered.
- [ ] **Step 8: Update `AGENTS.md` §8** "What exists now" with: the common requisition screens and actions on Approvals → Requisitions; feed creatable from both entry points through `POST /feed-requisition` with the row-13 check; staged shipment writes the source leg and receipt the destination leg; migration 0147; **0146 must be journalled with `when` > 1792000000016**.
- [ ] **Step 9: Commit** the report and `AGENTS.md` (explicit paths) — `docs(feed): Part E verified in the running app and MySQL`.

---

## Self-Review (done while writing; fixes applied inline)

**Spec coverage (§6a and the task brief):**
- One document for every type → Tasks 9 (common document), 11 (feed document shared), 13 (hub).
- Header view fields incl. approved by/at → Task 1 (writes), Task 3 (names), Task 9 (renders). Feed's extra header fields already render in `FeedRequisitionDocument` (Part A Task 9).
- Lines grid editable while open → Task 2 (API), Task 9 (UI), Task 12 (save).
- Feed from both entry points, same API → Task 10 (dialog with farm select), Task 11 (shared detail), Task 13 (hub), Task 15 Step 4.5–4.6.
- Manual feed line vs lifecycle item, exception reason (row 13) → Task 8 (API), Task 10 (dialog field).
- Approvals → Requisitions all types + type filter; New Feed/Item/FA/Service; Item Store/Purchase; FA/Service Purchase → Tasks 1, 10, 13.
- One inbox for every type; details reuse the documents read-only → Task 14.
- Own-farm feed approval (cp. 19), 20 % remarks (cp. 18), both diet lines together (cp. 23) → existing feed handler, untouched; Task 15 exercises an approval.
- Manual self-approval forbidden; system drafts follow the Farm Manager path → Task 1.
- After approval: Store → Release → staged transfer → Tasks 4–7, 12; Purchase → `BC_PENDING` + manual PO → existing release + link-po, Task 12 UI; Feed stops at Approved → unchanged, Task 15 checks no Release.
- Navigation/permissions → no new nav entry, no new permission pair (Tasks 7, 13 run the guard specs).
- Final verification → Task 15.

**Placeholder scan:** the two `// …` lines in Task 6 Step 5 point at concrete existing cases in `requisition.release.spec.ts` to copy, and name the row to add; Task 11 and Task 12 tests are specified by exact calls and labels rather than full listings because they reuse fixtures that live in existing specs — the implementer is told which file and which keys. Interpolation syntax and two schema column names are flagged as "check before use" with the grep to run, not guessed.

**Type consistency:** `transferPlanFor` (Task 6) returns `requisition_line_id`, which `StockTransferLineInput.requisition_line_id` (Task 6) and `stockTransferLine.requisition_line_id` (Task 5) carry, which `mapToTransferLines` and `syncRequisitionFulfilment` (Task 7) read. `findOne().shipments[].lines[].remaining` (Task 7) = `CommonShipment.lines[].remaining` (Task 9) used by `commonActions`. `RequisitionNewDialog` props `types` / `onCommon` (Task 10) are what the hub passes (Task 13). `FeedRequisitionDetail` `onView(view, notice?)` (Task 11) matches its two callers.

**Review Focus pinned:** 1 → Task 1 Step 5; 2 → Task 4 Step 2 and Task 7 Step 1/4; 3 → Task 2 Step 1 (rejected refused; Reopen exists) and Task 15 Step 4.8; 4 → Task 8 Step 4 and Task 10 Step 1; 5 → Task 6 Step 1.

## Rough time

| Task | Estimate |
|---|---|
| 1 List filter, manual source, approver stamp, self-approval | 40 min |
| 2 PUT /requisition/:id | 50 min |
| 3 Options and display names | 50 min |
| 4 Staged transfer posts once (incl. live repro) | 90 min |
| 5 Migration 0147 | 30 min |
| 6 Store release creates the transfer | 50 min |
| 7 Ship/receive + fulfilment sync | 80 min |
| 8 Manual feed line row-13 check | 45 min |
| 9 Common model + document | 75 min |
| 10 New dialog, all types | 50 min |
| 11 FeedRequisitionDetail extraction | 45 min |
| 12 Common document actions | 75 min |
| 13 Requisitions hub + page swap | 60 min |
| 14 Inbox details read-only | 40 min |
| 15 Running app + MySQL verification | 150 min |
