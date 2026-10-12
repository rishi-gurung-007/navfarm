# Brief — Phase 1 follow-ups (Rishi's 5 Oct answers + defects from the end-to-end pass)

Governing: docs/decisions.md, entry "2026-10-05 — Common requisition: requester, Service lines, receipt and release",
and Rishi's list docs/superpowers/plans/feed-completion/common-requisition-spec.md. Context: the end-to-end report
.superpowers/sdd/2026-10-04-feed-master-completion-plan/p1e2e-report.md (concerns 1–7).

1. Requester User ID shows the user's login (email), read-only, on the dialog, document and list where shown. The
   stored value stays the user id; resolve for display server-side in the document response (no second lookup copy).
2. Service lines: Description + Qty only — remove the Resource picker/column from Service lines (web) and stop the API
   accepting/requiring resource_id on SERVICE lines (keep reading any stored value harmlessly; say how many rows have one).
3. Transfer Receipt is posted by the **requester** of the requisition (requester_user_id), whose department must match
   the To Sub-Location (existing assertPostingDepartment). No separate receive permission for the requester. Find where
   receipt authorization is decided now and change it there once; a non-requester is refused with a clear message
   (Direct Transfer stays the sender's single action posting both — unchanged). Tests for requester allowed, other
   user refused, wrong-department requester refused.
4. Release may be pressed by any user who may approve the requisition (the same predicate the decide endpoint uses —
   reuse it, do not copy it); remove the sender-department restriction on Release only. Shipment keeps it.
5. Defect: a requisition raised by a user not tied to a farm has farm_id NULL even when Main / Farm Location is a farm
   (e.g. RQ-00033, GRA100). Derive farm_id from the Main / Farm Location (the location itself if it is a FARM, else its
   farm ancestor via parent_location_id) on create and update. Script-fix existing rows only if needed (db-* shape),
   reporting counts.
6. Defect: the pre-fix malformed ledger layer "SN00001,SN00002" at GRA100/SHED-001 (from RC-2026-0028) shows in the
   serial picker as one serial. Repair through a db-* script (plan / --verify / --apply, local only) that splits such
   layers into one layer per serial with exact value split, never touching rows that are consumed, and reports counts.
   Generic: detect any layer whose serial_no contains a comma.
7. UI: success messages appear behind the dialog — show them inside the dialog (or close it first), consistently for
   Save, Submit, Release, Shipment, Receipt, Item Tracking.

Gates and live proof as global-constraints (rebuild + restart API by PID; never pkill; log in via the app). Live: as
user@ raise a Store requisition, have it approved and released by an approver who is not the sender department,
shipped by the Stores user, received by user@ (refused for another user); a Service requisition shows only
Description + Qty; Requester shows the email; RQ-00033 gets GRA100; the serial picker no longer shows "SN00001,SN00002".
Put stock back. Read MySQL for each.

8. Minor (review of the end-to-end fixes): `requisition.service.ts` ~707 re-states the self-approval rule as raw SQL
   (AUTO_FORECAST exemption, created_by / requester_user_id). Put an SQL builder next to `isSelfApproval`
   (requisition.rules.ts ~448) and use it, or derive one from the other, with a test that both agree on the same cases.
