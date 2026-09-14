# Item 1 — Logins: audit and fixes, 2026-09-14

Three read-only audit agents (authentication mechanics, role permissions, scope
isolation), then three fix agents on non-overlapping files plus two fixes by the
lead. Tests, typecheck, build and every live probe were run serially by the lead.

## Fixed and verified live

Rebuilt API (`pnpm nx build api --configuration=development`, restart by
confirmed PID). Every write probe was built so that a failed fix could not
create or change anything: an existing email (a regression would 409, not
create), a target whose role is already SUPER_ADMIN, an unchanged name. Row
counts on `user_master`, `user_role_assignment` and `company_master` were
identical before and after (4 / 4 / 1; `tenant_system` users 1).

| Defect | Probe | Result |
|---|---|---|
| register-admin trusted an unsigned token | forged HS256 token claiming TENANT_ADMIN | **401** |
| | no token while the tenant has users | **401** |
| | real company.admin token, existing email | **409** — invite path still works |
| | company.admin inviting a COMPANY_ADMIN | **400** hierarchy |
| | body tenant ≠ `x-tenant-id` | **400** |
| Login enumeration | unknown email vs wrong password | identical **401** message |
| `/auth/users` open to any user | operator / company.admin | **403** / 200 |
| `user_type` accepted any string | company.admin creates TENANT_ADMIN, SYSTEM_ADMIN | **403**, **403** |
| | made-up type | **400** |
| | company.admin edits tenant admin | **403**, name unchanged |
| Role assignment checked nothing | company.admin assigns SUPER_ADMIN to tenant admin | **403**, roles unchanged |
| Breeding unguarded | no token / foreign company / real scope | **401** / **403** / 200 |
| Setup wizard unguarded | no token: company-details, status, step-1 | **401** ×3 |
| | operator: company-details / status | 200 / **403** |
| | tenant.admin status, operator nobs | 200, 200 |
| Translation unguarded | no token / operator | **401** / 401 |

Tests: **752 API tests / 70 suites pass** (was 623 / 61). API typecheck clean.

## Fixed, verified by unit test only

- **Lockout** after 5 failures, honoured for 15 minutes (the UTC misread). Not
  triggered live — it would lock an account the owner uses.
- **Soft-deleted users** refused at login, JWT validation and refresh. No deleted
  user exists to probe.
- **Invited OPERATIONAL_ADMIN no longer gets SUPER_ADMIN.** Live would create a user.
- **Company create/delete/restore** tenant-level only. Live would create a company.
- **Refresh sessions** no longer expire 5h30 early.

## Found, not fixed — needs a decision or its own step

1. **Operational scope is optional (item 2).** An OPERATIONAL_ADMIN or
   STANDARD_USER who omits `x-active-operational-area-id` reads every batch,
   approval, ledger row and animal. `roles.guard.ts:105` validates the header only
   when sent. No operational endpoint filters by area or farm, and creating a
   batch or animal never writes `operational_area_id`. This is item 2's work.
2. **Farm data is inconsistent.** The only operational area points at MUL100
   Grasmere; all 5 batches, 27 animals and the store sit under FARM-001, which is
   inactive.
3. **Operator bypasses the data-entry fence.** OPERATOR holds PRODUCTION/BATCH
   edit, which opens `/batch/bulk-daily-entry`, `/batch/:id/transaction` (neither
   checks the entry window) and close/dispose/split/merge/cancel. The treatment
   screen posts through `/transaction`, so the remap needs care.
4. **The seeded operator has no operational area**, so it is unusable in
   operational scope with correct headers.
5. **MFA can replace the password** if ever enabled: `mfa/verify` issues tokens for
   email + 6-digit code with no attempt limit. Latent — nothing sets `mfa_enabled`.
6. **Forgot password** says "Check your email" and sends nothing.
7. **Logout** leaves the access token valid for up to 15 minutes; a password change
   does not end other sessions.
8. **No rate limiting** on login (needs `@nestjs/throttler`).
9. **UTC written into a local-time database** via `toMysqlTimestamp()`, codebase-wide:
   last-login 5h30 behind, ledger reversals out of order. Auth reads are corrected;
   the writer is not.
10. **Web sidebar is not role-filtered**; `hasPermission` gives OPERATIONAL_ADMIN
    more than the API does and cannot express approve/delete.
11. Smaller: breeding lists trust an unvalidated `?company_id=`; `POST
    /language/resolve` and `GET /language` unguarded; `GET /company/:id` and
    `/user-company/assign` not scoped to the caller; the tenant middleware picks a
    database from an unverified token (every guarded route verifies afterwards);
    `edit-member-modal` offers COMPANY_ADMIN to a company admin, which now 403s.

## Not verified
Real rows crossing a company or area boundary — only one company and one area
exist. ACCOUNTANT and FARM_SUPERVISOR roles — nobody holds them. Anything in a
browser — no browser was opened, to keep memory free.
