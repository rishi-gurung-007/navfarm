# NAVFarm feed work: where we are and what comes next (5 Oct 2026, evening)

Any agent continuing this work: read `CONTINUE-PROMPT.md` (same folder) first. This file is the **current order of
work**. Where it disagrees with an older plan, this file and `docs/decisions.md` (newest entries) win.

## Where we are

**Phase 1: Common requisition (Item / Fixed Asset / Service) is done and verified, except one follow-up.**
- Done, reviewed and driven live in the browser (progress.md has every commit and evidence): admins approve any
  requisition; the Requisition page (top-level menu); Rishi's header/line/button list word for word; department checks
  on Transfer Shipment/Receipt; Direct Transfer right in User Setup; Item Tracking (lot/serial) with merged origin/main
  work; demo data (departments, tracked items); the LOB scoping fix; demo role permissions; all 7 end-to-end flows PASS.
- **In flight / next: the Phase 1 follow-up**, brief `briefs/p1f-brief.md` (items 1–8: requester shows email; Service
  lines Description + Qty only; the requester posts the receipt; any approver releases; farm taken from Main/Farm
  Location; repair the malformed "SN00001,SN00002" layer; success messages inside the dialog; one self-approval SQL rule).
  **How to tell what is done:** `git log --oneline` for commits mentioning those items after `fc64bc2a`, and the end
  of `progress.md`. Finish the missing items, then have them reviewed, then record `P1 follow-up: complete — <commits>`.

**Interpretations recorded in decisions.md that Rishi has NOT yet confirmed** (do not reverse them, but list them in
your report for him): Item Tracking assigned after release by the From department; Direct Transfer checks the From
department only; serial-tracked lines ship whole; transfers draw stock only from their From location.

## What comes next, in order

### Step 1 (≈ 10–14 h): one requisition document for every kind, feed included
Plan: `docs/superpowers/plans/2026-10-05-unified-requisition-and-feed-forecast.md`, **Tasks 1–5**.
Design: `docs/superpowers/specs/2026-10-05-unified-requisition-and-feed-forecast-design.md`.
Rishi's rulings (decisions.md 5 Oct):
- One Requisition page lists and creates every requisition, feed included. Feed is an **Item** requisition whose origin
  is `FEED_FORECAST` or `MANUAL`. There is no fourth user-facing type. This **reverses** WP1g's FEED exclusion from the list.
- Feed Forecast → Requisition opens or creates the same document, prefilled.
- A feed requisition shows Rishi's common header and lines **plus** the workbook's feed fields (Requisition and Loading
  Sheet §1–§2), shown only for feed.
- An approved feed requisition is **not** released as a common Store/Purchase. It waits for the mill flow (Step 3).
- Existing FEED rows and `/feed-requisition` URLs keep working through a compatibility facade.
- The approval inbox keeps excluding requisitions.

### Step 2 (≈ 15–22 h): Feed Forecast corrections
Same plan, **Tasks 6–9**, then Task 10 (verification):
- **Task 6:** Daily = every date from the selected date to the run-out date (max 45 days). Weekly = 7-day groups up to
  the group containing run-out. Live defect: VIL100 shows only 5 Oct although run-out is 21 Oct.
- **Task 7:** Farm → Shed → Silo selection shared by all tabs; the Dashboard gets KPI cards and charts, with the workbook table below.
- **Task 8:** New Physical Stock Count opens in a dialog.
- **Task 9:** Feed Plan, Tentative vs Actual.

Also in this step, from the master plan:
- **WP1d remainder:** remove the Stages sub-tab properly. Keep the next-diet projection. List any other non-workbook
  feature first.
- **WP4:** forecast demo data (diet changes inside stages; silos holding diets; some silos run short within 7 days).
- **WP6 Tasks 23–26, 28, 29, 32–36:** the remaining workbook field gaps; see `task-22-task-list.md`.

### Step 3 (≈ 12–16 h): the mill flow that fulfils feed requisitions
Master plan **WP7 (Part B)**, B1–B9: Mill Capacity Master, Production Output, Loading Instruction Sheet, Feed Mill
Manager Consolidation Sheet, Transfer Orders per farm per diet, Dispatch, Feed TO Receipt, the dashboard bin column,
and the workbook's Worked Example end to end.

### Step 4 (≈ 8–11 h): remaining planning, notifications and period end
- Master plan **WP8**: Compare Report, scheduler, email. The Feed Plan is already in Step 2.
- Master plan **WP9**: Monthly Stock Take and Period Close.

### Step 5 (≈ 4–5 h): finish
- **WP10:** shared display primitives.
- **WP11:** whole-branch review. Fix `align-feed-tdd.ts` for inactive and deleted farms, then migration 0146 (column
  drops) **only after merge, with Rishi**.

**Total remaining ≈ 50–68 agent hours.**

## Rules that matter most (full list: `briefs/global-constraints.md`)
- Work only in `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`. Never push or merge.
- One builder at a time on this branch. Check `git status` first, then finish or review anything uncommitted.
- Test-first; jest `--maxWorkers=2`. After an API change, rebuild and restart the API by PID (never pkill), then grep the bundle.
- Prove every write in the running app (:3002 / :2877) and in MySQL `nf_devco`. A green suite is not proof: driving the
  screens found 7 defects in Phase 1 alone.
- Log in only through the app. Never mint tokens. Data changes go through `db-*` scripts (plan / `--verify` / `--apply`).
- **Do not guess.** If decisions.md, the workbook (`workbook-fields.md`), Rishi's list (`common-requisition-spec.md`)
  and the plans do not answer something, stop and ask Rishi. Record his answer in decisions.md.
- After each step append `<step>: complete — <commits>` to `progress.md` and commit it. Before stopping for any reason,
  append `Controller: <agent> stopped at <step> — <state>`.
