# Brief B: Feed scheduler and email notifications

## Workbook rows (read them in workbook-fields.md)
- Sheet "Feed Forecast" r7 (Wednesday tentative plan), r8 (scheduled run, manual rerun), r9 ("Feed alerts, mill plan
  request and dispatch messages are issued through NAVFarm in app and configured email channels").
- Sheet "Feed Forecast Engine" r2 (scheduled runs) and r69 ("Wednesday 09:00 tentative run; Sunday stock check are
  Triple-C defaults ... Tenant configurable").
- Sheet "Master Setup" Section 4 Alerts and Notifications Master, rows 41–56: Event Type, Recipient Roles, Delivery
  Channel (IN_APP, EMAIL ...), Frequency, Escalation After Hours, Escalation Recipient Role, Active, Farm Filter.
- Sheet "Requisition and Loading Sheet" Section 4 Approval Workflow (rows 78–111): the Friday reminder and Saturday
  cutoff/deadline notifications. Mill dispatch notice (Section 3 r58).
- decisions.md 1 Oct: the Friday 18:00 reminder, Saturday 12:00 cutoff, Sunday 08:00 count and the `Africa/Harare`
  time zone are CONFIGURATION, not hard-coded. Find where Feed Planning Settings hold them. If absent, add settings
  rather than constants.

## What exists (reuse it)
- `modules/system/alert-rule` (Alerts and Notifications Master) and `modules/system/notification` (in-app, and email via
  nodemailer in notification.service.ts). The feed alerts that already fire. Grep FEED_BELOW, MILL_DISPATCH.

## Build
1. A scheduler. Use `@nestjs/schedule` if it is already a dependency. If it is not, STOP and report: adding a dependency
   needs `pnpm add` and must be confirmed. It runs per tenant and per company, reading times and days from settings
   in the company time zone:
   - Wednesday: generate the TENTATIVE Feed Plan through the existing feed-plan service (no second calculation), then
     notify "plan available";
   - Friday reminder: open AUTO_DRAFT or DRAFT feed requisitions not submitted;
   - Saturday cutoff: CRITICAL notice to the Farm Manager and Head of Farms for unsubmitted ones;
   - daily: an upcoming diet change within 3 days (if the forecast exposes next-diet dates);
   - escalation: unacknowledged alerts older than Escalation After Hours go to the Escalation Recipient Role.
   Idempotent: never send the same event twice for the same document and period. Record what was sent. If a
   notification log table exists, reuse it. A new table is migration 0166_feed_schedule_log, idx 165, when
   1792000000034 — but tell the controller BEFORE applying it to nf_devco, because another builder applies 0165 first.
2. Email delivery through the existing notification service, per the Alerts master Delivery Channel. With no SMTP
   configured, log SKIPPED and never claim SENT.
3. A manual "Run now" endpoint per job, admin only, for testing.

## Work location
Your own worktree: /Users/nero/Desktop/navfarm-wt-scheduler (branch feat/feed-scheduler-email, from 2b521466).
node_modules are symlinked from navfarm-final-uat. Do NOT rebuild or restart the shared API on :2877. Prove the jobs with
unit tests and with a script or test that calls the job service directly. The controller merges your branch and runs
the live proof.
