# Health foundation verification — 2026-09-14

Continuation after F1–F3; earlier five-document posting exercise is in
VERIFICATION-2026-09-14-foundation.md. All new fixtures are explicitly diagnostic.

## F5: generic approval

Rebuilt API with `NODE_OPTIONS=--max-old-space-size=1024 pnpm nx build api`, stopped
lsof-confirmed PID 12371 and started the rebuilt bundle. No nx serve hot-reload
assumption. API suite at this point: 614 tests, 60 suites pass.

- POST batch `3a2af9ca-caad-4fa3-a68c-dd35aaf93d3a` unscheduled health: request
  `1d3f89a2-3303-4145-bd67-08413eb510b2`, HLT-UNS-2026-0002. MySQL PENDING, 1 PACK
  Tylosin, no posting counts changed.
- POST generic approval: MySQL APPROVED; batch transaction
  `0fc52cf2-bcf5-4b98-9029-0450bc325949`, ledger
  `c0f9cb3f-46e1-4875-8dd3-a82ff6eb0819`, quantity -1, amount -350, journal
  JE-000017. Counts moved from 16/9/16/32/312 to 17/10/17/34/313
  (ledger/applications/journals/journal lines/batch transactions).
- Repeat generic approval returned 400 already approved; all five counts unchanged.
- Request `07ddaf0d-7739-4be0-87c0-ac73a7aa77e2`, HLT-UNS-2026-0003, requested
  1000 PACK. Generic approval returned shortage 985. MySQL PENDING, decided_at NULL,
  all five posting counts unchanged. Retained as a diagnostic pending request.

## Browser recovery

The original frontend was looping on EPIPE with disconnected output streams.
Restarted the confirmed frontend PID with redirected logs, retaining 1GB Node heap
cap. A fresh in-app tab opened at 1280 x 800. Browser then exposed stale saved auth
with an expired presence cookie: root/dashboard redirected without reaching login.
Restoring the middleware presence hint before client navigation allowed the stale
API session to expire normally, and login then reached Triple C dashboard and the
health register. This does not replace API authentication.

## F6 work in progress

GR-000005 (`079c5f3c-c024-4723-8d68-caea98d5e354`) created/posted through API.
MySQL confirms 4 DOSE Parvo-Shield vaccine at configured 85 = 340, lot
DEMO-F6-20260914, remaining 4. JE-000018 debit/credit both 340. Warehouse remains
the existing inactive demo silo used by the foundation exercise; inactive-location
acceptance is a known separate gap, not claimed fixed here.

## F6 completed live checks

After the final API rebuild/restart (stopped lsof-confirmed PID 14093):

- Old missing-item/DOSES request returned 400, no arbitrary medicine selected.
- Browser selected PIG-BAT-2026-0101, SOW-LW-018 and Parvo-Shield from the actual
  medicine/vaccine picker. Quantity 1000, lot DEMO-F6-20260914 returned shortage 996;
  dialog stayed open with error, no fabricated treatment, MySQL vaccine remaining 4,
  treatment-detail count 40, ledger/journal counts 18/18.
- Browser changed quantity to 1 and entered an explicitly diagnostic one-day
  withdrawal. Successful transaction `93651cee-df52-476b-92fe-af8b3df96e49` records
  animal `0893c0d6-bc50-4ab2-858d-69d6afbea400`, vaccine
  `14b94bfd-9b8c-49d1-9f28-cc00062849b0`, 1 DOSE, amount -85. Ledger
  `2fe2ba94-03ba-44ec-91d2-494b0d14936e` issues the same lot; receipt ledger
  `30c1b42a-8f42-47f9-8e56-7386fa3851aa` remains 3. JE-000019 debit/credit 85/85.
  `batch_treatment_detail` has recorded withdrawal 1 and veterinarian NULL.
- Full browser reload retained the treatment row and chosen vaccine.
- GET animal/lookup/tag?tag=SOW-LW-018 returned hasActiveWithdrawal=true and vaccine
  daysRemaining=1. PATCH disposal SLAUGHTERED on 2026-09-14 returned 400 naming that
  vaccine. MySQL animal remains active=1, PREGNANT, disposal_date/type both NULL.
- Supplying DOSES for the selected DOSE-stock vaccine returned 400, unchanged counts.
- Final posting counts: 19 ledger, 11 applications, 19 journals, 38 journal lines,
  314 batch transactions. No automatic stock insertion occurred.

Validation: API 623 tests/61 suites; web 156 tests/24 suites. API/web typechecks pass;
API production build passes with existing Express dynamic-dependency warning. Web
lint reports 79 errors/671 warnings, below the documented 85-error baseline; existing
empty catches remain in unrelated mortality/read paths. Tests/builds ran serially
with a 1GB Node heap limit. No full frontend production build was run.

Not verified: concurrent request stress tests, every role's UI permissions, live
expiry-boundary disposal (would dispose the diagnostic animal), BIO_ASSET treatment
costing, standalone medication-log concurrency, batch-level health approval applying
a withdrawal to all animals. Approval still stores a medicine name rather than its
UUID; renamed/ambiguous/changed-unit requests refuse. Historical demo clinical rows,
future dates and inactive-location acceptance were not comprehensively repaired.
Farm-wise access is not designed: the operational-only versus master-data scope
question has been presented to Rishi and remains unanswered.
