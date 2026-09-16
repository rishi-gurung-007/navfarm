# Verification — 16 Sep 2026: daily data entry and the audit ledger

Driven through the running API (`:2877`, rebuilt bundle, tenant admin) and read
back from MySQL (`tenant_devco`). Batch BATCH-000001, line 74499efd (CONSUMPTION,
Dry Sow Gestation Mash), date 2026-09-16. Remarks labelled `DEMO VERIFICATION`.

| Step | Result | Proof |
|---|---|---|
| `PUT .../daily-data/draft` | DRAFT v1, no side effects | `batch_daily_data` DRAFT; `inventory_ledger` 89 → 89, `batch_transaction` 355 → 355 |
| `POST .../post` without a lot | 400 "'Gilt Grower Feed' requires a lot number." and nothing posted | row still DRAFT; both counts unchanged; zero target rows |
| draft again with the lot | v2 | version returned 2 |
| `POST .../post` | POSTED v3 with the stage's animals as targets | `inventory_ledger` 89 → 90, `batch_transaction` 355 → 356 |
| `PUT draft` on the posted line | 409 "This line is already posted. Use Correct to change it." | no row change |
| `POST .../correct` | old row SUPERSEDED with `superseded_at`, new POSTED row carrying `supersedes_entry_id` | two rows, v3 SUPERSEDED / v4 POSTED; ledger 90 → 92 (reversal + replacement) |
| `GET .../form` | lines, activities and targeting per the Phase 6 contract | `targeting.mode` REGISTERED, `default_scope` STAGE_ANIMALS with animal codes |
| Master edit → audit | before and after both stored, with the user | `audit_log` UPDATE on `disease_master`: before "Porcine Reproductive & Respiratory Syndrome", after "DEMO VERIFICATION rename", `user_id` set (name restored afterwards) |
| `GET /audit-log` | user name, email, type and roles on every row | LOGIN row carries `user_name`, `user_email`, `user_type`, `user_roles` |

Migration 0098 (requisition) had no statement breakpoints and silently created
nothing while the migrator reported success; split and applied, `requisition`
and `requisition_line` now exist on both tenants.

Not verified here: the browser screens (entry workspace, audit expansion, animal
tabs), the nine-farm data, and the requisition endpoints.
