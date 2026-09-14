# Foundation write-path verification — 2026-09-14

Scope: Rishi's handoff §2 F1, F2, F3, followed by the five API document writes.
Database: `tenant_devco`. All newly entered quantities and diagnostic amounts
are **DEMO VERIFICATION**, not Triple C operational facts. Existing item,
warehouse and batch IDs were reused. No master identities were invented.

## What changed

- F1: omitted GL dimensions no longer require a NULL mapping; supplied values
  still match exactly or a wildcard. Cleared the audited company's 29 FIFO
  pins, 3 feed-category pins and 13 Gestation pins through the registered
  `db-repair-demo-gl-dimensions` target, `--verify` then `--apply`. MySQL:
  `n=29,val_wild=29,cat_wild=29,stage_wild=29`. Removed the seed statements that
  reapplied those pins. NOB/LOB and debit/credit accounts were preserved.
- F2: insufficient FIFO stock throws 400 and creates no automatic opening
  stock. FIFO additionally filters by company. At the start and end of this
  exercise there were **zero** AUTO-STOCK-REPLENISH rows; the earlier handoff's
  observation of such a row was not the current database state.
- F3: document creation/posting, system journals, batch transactions, daily
  posting and dedicated health approval share a CLS transaction executor.
  Status, inventory, applications, GL, audit and explanatory rows roll back
  together. Batch/request locks serialize the relevant posting operations.
- Daily consumption correction reverses the old issue at its original cost,
  restores its exact FIFO layers, swaps the original journal accounts, writes
  a compensating batch transaction, then posts the replacement. All happen in
  one transaction. Exact repeat submissions do not post again. New posting
  IDs are returned explicitly, replacing an unordered-last-row guess.
- Review caught two follow-on defects: absolute-value costing added reversals
  as new cost, and daily lot numbers never reached FIFO. Cost aggregation now
  subtracts reversal quantities while preserving legacy positive seed amounts.
  Lot numbers flow through the DTO/services into exact-lot FIFO and the ledger.
  Health approval locks the batch before establishing a repeatable-read snapshot.

## API writes and MySQL evidence

API was rebuilt with `NODE_OPTIONS=--max-old-space-size=1024 pnpm nx build api
--configuration=development`, then only the API listener confirmed with `lsof`
was stopped and the new bundle started. A second rebuild/restart included the
review fixes before the correction tests. Web was not stopped.

Logged in using the handoff's company administrator. Requests carried all four
scope headers from handoff §8. MySQL was read after **each** create/post attempt,
including failed requests. Headers, lines, ledger amounts, FIFO applications and
journal line totals were checked, not just HTTP status codes.

| API document | ID / number | Observed persisted effect |
|---|---|---|
| GRN | `f2d83c87-accb-48a7-acfa-086473bcf62c` / `GR-000003` | POSTED, 20 PACK Tylosin at the existing master rate 350; inventory +20 / 7000; JE-000006, two balanced lines 7000. |
| Issue | `cc92ae9c-f5cd-4178-a695-66ba596d3a4c` / `GI-000002` | POSTED, -2 PACK / -700; FIFO application 2 / 700 against GR-000003; JE-000007. |
| Transfer | `cfec216e-5c4e-45d0-89e9-4952f21fd085` / `TR-000002` | POSTED, source -3 and destination +3, both at 350; -1050/+1050; JE-000008 and JE-000009. |
| Adjustment | `710be1f4-dbca-4b47-b148-a004aac328a8` / `ADJ-000002` | POSTED, -1 PACK / -350; FIFO application 1 / 350; JE-000010. |
| Batch consumption | transaction `54e424d6-5738-434e-930b-095862a19bcf`, batch `PIG-BAT-2026-0101` | 1 PACK, amount -350, linked ledger `1be59e0f-b359-4c42-bec7-ae175d5a17dd`; FIFO application 1 / 350; JE-000011. |

The batch transaction route is singular: `POST /batch/:id/transaction`. An
initial plural-route attempt returned 404 and wrote nothing.

Tylosin item: `a82256c5-390a-4441-96d5-d695084091f9`. Final source balance
13 PACK / 4550 at `baea1664-bc70-4a68-8c66-2d0aafdc3ac2`; destination 3 PACK /
1050 at `4e3c5579-00bb-498f-b45a-c447e1f0d9b4`. These existing demo warehouse
locations are inactive; the API accepted them. This is a remaining validation
gap, not evidence that real farm warehouse selection was verified.

### Daily correction and retries

Existing scheduled line `aa17f870-29bb-4a54-93c3-658286a634d4` uses Pig Feed
`2570efe7-20c5-4831-a0a1-0b1c68840300`, whose valuation method is NULL.
A second labelled diagnostic receipt, `GR-000004`
(`03ca82ac-cb94-4276-85fd-41dacadfdaed`), supplied 10 KG at a **diagnostic rate
of 1**, explicitly not a client valuation, lot `DEMO-F3-20260914`.

`POST /batch/3a2af9ca-caad-4fa3-a68c-dd35aaf93d3a/daily-data`:

1. Entered 4.6: receipt remainder 5.4; batch transaction
   `a44d02eb-20af-4cdf-8fed-5f05ce2dc722`, ledger
   `7410c9de-2c4f-4861-9c3f-24dae96e6385`, JE-000013.
2. Corrected to 5 after rebuilding the lot fix: old issue reversed by ledger
   `7f92ea18-4054-4e96-965c-41af7535be1f` and JE-000014. MySQL confirmed the
   original debit/credit accounts swap. New transaction
   `ddc4fdc9-8ed1-46aa-a78f-78f5913dc9f7`, ledger
   `da014618-0766-439b-9e5d-0f1cfab0bdbb`, JE-000015, carries the selected lot.
   Net quantity/cost consumed is 5/5; original receipt remainder is 5.
3. Corrected to unavailable test lot `DEMO-F3-UNAVAILABLE`: 400, short by 5;
   attempted reversal rolled back. Same daily value 5, same lot, same posting
   reference, and unchanged counts: 16 ledger / 9 application / 15 journal /
   30 journal-line / 311 batch-transaction rows.
4. Repeated the valid value 5: same posting reference and those same counts.

The daily row is `535b73ec-08f9-4e5b-bd7f-959b24299287`, date 2026-09-14.
The initial 4.6 ledger row predates the lot-forwarding fix and has NULL lot;
its source application links the actual receipt lot. It was reversed rather
than silently rewriting history.

Automatic approval review initially rejected running the correction on the
old bundle because of the discovered lot gap. The gap was fixed, tested and
rebuilt before retrying; no bypass was used.

### Failure atomicity and the original F1 call

- `GI-000003` (`6226dc3c-ccc8-4e7b-a20e-3520b0a5e31c`) has two diagnostic
  lines: 1 PACK and 1000 PACK. Posting fails on the second, short by 988 after
  the first line's attempted draw. **It remains DRAFT**, source remainder 13,
  with no new ledger, applications or journal rows. Left as a labelled draft
  for Rishi to inspect/retry; it is not a client requisition.
- Batch OVERHEAD diagnostic amount 1 posts without valuation/item context:
  transaction `59e8ead4-081a-45ea-bfba-286c11584c95`, JE-000016, two balanced
  lines at 1, no inventory movement. This exercises F1's original failing
  `postBatchCostEntry()` path.
- Dedicated health approval `HLT-UNS-2026-0001`, request
  `96177c56-085a-47c9-aace-785ec9664732`, attempted a clearly labelled 1000 PACK
  diagnostic shortage. Approval returned 400 (short by 984), stayed PENDING,
  and ledger/GL/batch counts did not change. Then rejected through its API
  with a diagnostic reason; MySQL confirms REJECTED. No clinical event is
  represented as having occurred.

Final counts after these checks: **16 inventory ledger, 9 applications,
16 journal headers, 32 journal lines, 312 batch transactions**.

## Checks and limits

- 593 API tests across 59 suites passed; API typecheck passed; development
  build passed with one Express dynamic-dependency warning. Heap capped at
  1024 MB, tests in one process, no parallel local builds.
- A subagent reviewed backend code and implemented the reversal-cost and lot
  fixes. It ran no builds, tests, servers or browser processes.
- The five document writes, daily correction/retry/failed correction,
  multi-line shortage rollback, no-context overhead posting and dedicated
  health shortage were verified live by API plus MySQL.
- **Not verified:** all biological costing events, live biological reversal,
  concurrent health capitalization, successful dedicated health approval,
  batch close/variance posting, every valuation method, positive adjustment,
  or a production deployment. The cost-netting regression has unit coverage;
  the actual close operation was not run against a client's/demo batch.
- Posted OUTPUT, OVERHEAD, RESOURCE and TRANSFER daily corrections are refused
  with 409 when they require a document-specific reversal; they no longer
  silently double-post. Consumption reversal is the implemented correction
  path. A biological consumption cannot be reversed after its premature
  capitalization is no longer safely recoverable.
- F5 generic health approval dispatch and F6 arbitrary medicine selection are
  **not fixed** in this phase. Farm-wise access design was not started.
- Other observed limitations: existing retired warehouses accepted by these
  write APIs; differing local/UTC timestamps in seeded/application audit
  fields; warehouse-filtered movement history omits company-wide batch issues
  although stock balance uses the original layers and is correct.
- In-app browser opened at a fixed **1280×800**, but frontend remained stuck
  compiling and `/login` timed out. Browser UI verification is not claimed.
  Backend and frontend listeners were up. A frontend restart was requested
  separately because memory was not critically pressured and Rishi's standing
  instruction forbids stopping it merely to save memory.

## Quick read-only checks

```sql
SELECT document_no, transaction_type, quantity, remaining_quantity, rate,
       amount, lot_no, external_reference_no
FROM inventory_ledger WHERE created_at >= '2026-09-14';

SELECT d.entered_value, d.lot_no, d.posting_reference,
       t.quantity, t.amount, t.ledger_id
FROM batch_daily_data d
LEFT JOIN batch_transaction t ON t.transaction_id = d.posting_reference
WHERE d.entry_id = '535b73ec-08f9-4e5b-bd7f-959b24299287';

SELECT h.journal_no, h.source_document_no, h.source_ledger_id,
       h.total_debit, h.total_credit,
       SUM(l.debit_amount) line_debit, SUM(l.credit_amount) line_credit
FROM journal_header h JOIN journal_line l ON l.journal_id = h.journal_id
WHERE h.created_at >= '2026-09-14' GROUP BY h.journal_id;
```
