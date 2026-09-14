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
