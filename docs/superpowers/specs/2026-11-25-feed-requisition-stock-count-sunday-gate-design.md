# Feed requisition sending rule: Sunday + posted stock count — design

25 November 2026. Rishi approved "check on send". This replaces the earlier
version of this file, which blocked creation and used the farm's configurable
count day.

## Intent

A feed requisition can be sent only on Sunday, by the farm's calendar, and only
after that day's physical stock count. Ordering follows a weekly cycle anchored
to a verified count.

## The rule

Checked at one point: **Submit for approval**
(`FeedRequisitionService.submit`, `POST /feed-requisition/:id/submit`).

1. **Sunday.** The farm's today must be a Sunday. Sunday is fixed; the
   `physical_count_weekday` setting is not read by this rule.
2. **Count.** Every silo line needs its feed counted in a **POSTED** stock count
   whose `counted_at` falls on that same farm day. DRAFT, PENDING_APPROVAL,
   APPROVED and REJECTED do not count. It is the day counted, not the day posted.
   Weekly and monthly counts both qualify.
3. **Store lines** need no count (nothing counts a store). The Sunday rule still
   applies to them.
4. **Pairs that cannot be counted.** A count only has lines for silo and item
   pairs that have inventory ledger history
   (`InventoryLedgerService.getSiloStockEvidenceAsOf`). So for a silo line:
   - the silo+item has history → that pair must be counted;
   - the item has never been in that silo but the silo has other history (a diet
     change) → the silo must appear in a posted count dated today;
   - the silo has no history at all (new, never filled) → no count needed.

   Without this, a first order of a new diet could never be sent. This was found
   while planning; Rishi approved this exception on 25 November.

## Farm calendar

The farm's today comes from `FeedForecastService.farmToday`, which reads the
**company's** `default_timezone_id` and falls back to the server's day when no
usable zone is set. Farm locations have no timezone or calendar field. All of a
company's farms therefore share one calendar. Per-farm timezones and holiday
calendars are not part of this work.

## Unchanged

- Creating drafts (manual, from a calculation, auto-draft) and editing or saving
  them: any day. No scheduler is added.
- A sent requisition is already locked (`isEditableFeedRequisition` is false once
  it has an approval request), so no edit check is needed. After a rejection or
  withdrawal that returns it to draft, sending again goes through this rule.
- A legacy PENDING_APPROVAL row with no approval request is sent through
  `submit`, so the rule covers it.
- Approval, release, shipment and receipt have no Sunday rule.
- Late-submission and deviation remarks rules, the production cycle, the stock
  count module and common (non-feed) requisitions.
- No midweek override. Whether urgent requests need one is the client's call.
- No database migration.

## What the user sees

- The server refuses with HTTP 400 and says why. Edits sent with the refused
  submit are rolled back.
- `GET /feed-requisition/:id/submit-gate` returns
  `{ allowed, today, problems }` for the saved lines.
- The open requisition shows the reasons and disables Submit. Save stays
  available. If the user has an unsaved silo or item change, or the check cannot
  be loaded, Submit stays enabled and the server decides.

## Anti-goals

- A requisition reaching an approver without passing the rule.
- A requisition that can never be sent because its feed cannot be counted.
- Saving a draft being blocked.

## Verification

Tests for Saturday, Sunday and Monday around midnight in the farm's zone; a
count that is approved but not posted; one posted today but counted last Sunday;
store lines; the diet-change and empty-silo cases; edits sent with a refused
submit. Then drive the running app and read MySQL. The accepted path needs a
posted count on a real Sunday (29 November 2026 is the next one); `nf_ccc` has no
POSTED count today, and none is created without Rishi's permission.
