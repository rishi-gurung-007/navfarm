# Costing: TDD gaps and simpler Costing Run page

Date: 2026-10-29. Source: audit of `Final TDD_V1.csv` against the code (see the conversation).
Rule for every phase: prove a write by making it and reading MySQL. A green suite is not evidence.

## What other systems do (research)

- **Business Central, Calculate Depreciation:** one small request page (depreciation book, posting date,
  document no., insert balancing account, 365-day option). It *suggests lines in a journal*; the user reviews
  and posts. A wrong run is undone with "Cancel FA Ledger Entries", then run again.
  [fa-how-depreciate-amortize](https://learn.microsoft.com/dynamics365/business-central/fa-how-depreciate-amortize)
- **SAP AFAB:** the same screen for test and real. Tick **Test run**, check the result, untick, run for real.
  A repeat run posts only the difference, never doubles.
  [Executing the Depreciation Run](https://help.sap.com/saphelp_46c/helpdata/en/fb/f6b96c0cfd11d3b65d0000e82d962e/content.htm)
- Pattern to copy: **pick period -> preview -> review -> post**, few fields, the preview is the main thing.

## Phase 1 - Costing Run page: simple and clear (do first, user-facing)

Today `bio-costing-runs-panel.tsx` (654 lines) shows batch, animal picker, period date, days enforced,
description, a due-runs banner, stat cards, line table and a reverse dialog all at once.

Target: three steps on one page.
1. **Choose**: Item, Period (month picker), optional Batch. Everything else (days enforced, description, single
   animal) under an "Advanced" fold.
2. **Preview**: button "Calculate" shows a plain table: animal, days, charge, book value after, and a clear
   reason when skipped. Totals on top. Nothing is posted yet, and the page says so.
3. **Post**: one primary "Post to ledger" button. "Reverse" lives in the run's menu, with a reason.
Also: plain wording (no "residual floor"), "Run due now" kept but explained in one line, empty states that
say what to do next, loading and error messages in words.
Done when: a new user runs September costing for one item in three clicks; screenshots in light and dark and
at phone width; the existing panel spec is updated; posted journal read back from MySQL.

## Phase 2 - Prove fair value end to end (unproved C1)

Seed an FV item (rate by date, CDM flag), calculate, post, read back gain/loss journals; prove refusal when
no rate exists; reverse it. Add a small seed chapter and a verify script, same pattern as `costing-two`.

## Phase 3 - Prove frequencies, day basis, auto-post, scheduler (unproved C2-C4)

Quarterly and yearly runs, ACTUAL day basis, auto-post item, and the scheduler posting unattended against
MySQL. One verify script reading the ledger back.

## Phase 4 - Due-run notification (gap 5)

Use the existing notification mechanism (check first what the repo has) to tell finance a run is due.

## Phase 5 - Bio item rules (gaps 2 and 1)

- Lock the normal Costing Method (Standard/FIFO/Average) next to the bio method on bio items.
- "NavFarm Item" flag on the item card: needs a decision, because nothing syncs yet.

## Phase 6 - Cull / sale conversion with Finance approval (gap 4)

Conversion record, approval step, CONVERTED_INV status, the sale follow-on. Design with Finance first.

## Phase 7 - Decision items (gaps 3 and 6), no build before the decision

- Child FA per animal: a Business Central concept. Needs BC integration scope.
- Separate Amortization Entry / Fair Value Entry tables: the same effect exists as run lines plus ledger rows.
  Recommend keeping it, and mapping the names in the BC export later.

## Order and why

Phase 1 first (users say it is confusing). Phases 2-3 next because they turn "built" into "proved".
Phases 4-5 are small. Phase 6 needs design. Phase 7 needs an answer.
