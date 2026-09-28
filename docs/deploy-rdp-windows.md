# Windows RDP test-server deployment

This runbook deploys the current NAVFarm repository to the shared Windows test
server. It is a demo/testing deployment, not a production architecture.

## Server layout

| Component | Binding | Public? |
|---|---|---|
| RDP administration | `103.234.185.14:9296` | Restricted to administrators |
| NAVFarm web | `0.0.0.0:3002` | Yes, for initial testing |
| NAVFarm API | `127.0.0.1:2877` | No; reached through the web proxy |
| MySQL 8.4 (`MySQL84`) | `127.0.0.1:3306` | No |
| MySQL X Protocol | `33060`, if enabled | No |

Port 9296 is only the RDP endpoint. It is not an application port and must not
appear in NAVFarm environment files. Redis is not used by NAVFarm and is not
required for this deployment.

The browser always calls the same web origin under `/api/v1`. The Next.js
server proxies those requests internally to `http://127.0.0.1:2877`; testers do
not connect to the API port directly.

## 1. Update the repository

Run from an ordinary PowerShell session. Replace the example path below with
the actual repository checkout. Confirm that `git status` is clean before
changing branches or pulling; do not discard unreviewed server changes.

```powershell
Set-Location C:\path\to\navfarm
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
```

**One time only — moving off the pre-24 September `main`.** On 24 September
2026 `main` was replaced rather than advanced (it had stopped at 14 September;
the old tip is kept as branch `main-backup-2026-09-24`). A checkout still on the
old `main` cannot fast-forward, so `git pull --ff-only` stops with "Not
possible to fast-forward". Only when `git status --short` printed nothing, move
the checkout onto the new `main` instead:

```powershell
git reset --hard origin/main
git log -1 --oneline
```

`reset --hard` discards uncommitted server changes, which is why the clean
`git status` comes first. Every later update is the ordinary `pull --ff-only`.

Install the repository's declared pnpm version and dependencies:

```powershell
corepack enable
corepack prepare pnpm@11.10.0 --activate
pnpm install --frozen-lockfile
```

## 2. Verify MySQL

MySQL Community Server 8.4.11 is expected as service `MySQL84`:

```powershell
Get-Service MySQL84
Get-CimInstance Win32_Service -Filter "Name='MySQL84'" |
  Select-Object Name, State, StartMode, PathName
Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

If the `mysql` command is not on `PATH`, use the installation path reported by
the service. For the current version it will normally resemble:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" --version
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe" -h 127.0.0.1 -P 3306 -u root -p
```

Enter the password only at the prompt. It cannot be recovered from NAVFarm and
must not be written into terminal history. In MySQL, verify the local service:

```sql
SELECT VERSION() AS mysql_version, @@hostname AS host, @@port AS port,
       @@datadir AS data_directory;
SHOW VARIABLES LIKE 'bind_address';
SHOW DATABASES LIKE 'nf_master';
SHOW DATABASES LIKE 'nf_system';
SHOW DATABASES LIKE 'nf\_%';
```

The database account in `apps/api/.env` must be able to create and migrate
`nf_master`, `nf_system`, and `nf_<tenant_code>` during bootstrap.
Every NAVFarm database starts with `nf_`, because this MySQL is shared with
another application: grant the NAVFarm account rights on `nf\_%` only, and
nothing NAVFarm creates or drops can land on the other application's databases.
Keep MySQL bound locally and do not create inbound firewall rules for 3306 or
33060.

## 3. Create the required environment files

Both files below are ignored by Git. Create them directly on the server and
never commit them. Do not put a generic `PORT` in the repository root or in the
PowerShell profile; it can leak from the API process into Next.js.

### `apps/api/.env`

```dotenv
NODE_ENV=production
NAVFARM_API_HOST=127.0.0.1
NAVFARM_API_PORT=2877
API_PREFIX=api/v1
API_DOCS_PATH=api/docs

# The browser origin has no trailing slash.
CORS_ORIGINS=http://103.234.185.14:3002
FRONTEND_URL=http://103.234.185.14:3002

# Replace this with a persistent directory outside disposable build output.
UPLOADS_DIR=C:/path/to/persistent/navfarm-uploads

DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USERNAME=REPLACE_WITH_LOCAL_MYSQL_USER
DATABASE_PASSWORD=REPLACE_WITH_LOCAL_MYSQL_PASSWORD
DATABASE_NAME=nf_master
DATABASE_SSL=false

JWT_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
ENCRYPTION_KEY=REPLACE_WITH_A_DIFFERENT_LONG_RANDOM_SECRET

SYSTEM_TENANT_DATABASE=nf_system
SYSTEM_ADMIN_NAME="NAVFarm System Administrator"
SYSTEM_ADMIN_EMAIL=REPLACE_WITH_ADMIN_EMAIL
SYSTEM_ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_ADMIN_PASSWORD

# Demo seed identity. The seeded operational values are intentionally synthetic
# test data until the real client dataset is supplied.
DEV_TENANT_CODE=devco
DEV_TENANT_NAME="Triple C Demo"
DEV_COMPANY_CODE=TRIPLEC
DEV_COMPANY_NAME="Triple C Demo"

# Optional; password reset/email delivery is unavailable while these are blank.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME="NAVFarm Support"
```

Generate JWT and encryption secrets independently using an approved password
manager or cryptographic secret generator. Do not reuse the MySQL or system
administrator password.

### `apps/web/.env.local`

```dotenv
NAVFARM_API_MODE=proxy
NAVFARM_API_UPSTREAM_URL=http://127.0.0.1:2877
```

These are server-only settings. No public server IP or API port is compiled
into the browser bundle, and no `NEXT_PUBLIC_API_URL` or
`NEXT_PUBLIC_SOCKET_URL` is needed. Rebuild the web application if this file
changes because Next.js records rewrites during the build.

## 4. Build the demo databases

From the repository root, first as a read-only dry run:

```powershell
pnpm nx run api:db-rebuild-demo
```

It prints the databases it would drop and the ordered command list, and changes
nothing. It only ever targets `nf_`-prefixed databases on `127.0.0.1` — the
guard refuses any other name and any remote host — so it cannot reach the
other application's databases on this MySQL. On a first install it reports
`Would drop (reset step only): (none found)`. **If it lists anything that is
not NAVFarm's, stop.** Otherwise:

```powershell
pnpm nx run api:db-rebuild-demo -- --apply
```

This is the same chain the development machines use: schema, the Triple C
tenant and company, the real farm locations and masters, the nine-farm demo
(sheds, pens, silos, breeds, lifecycles, logins) and the posted demo chapters.
The chapters take a few minutes. The data is synthetic test/demo data by
design; do not remove it merely because it is synthetic.

`db-seed-demo` is the older demo chain and does not build the nine farms or
their silos; do not use it for this server.

Check the result in MySQL:

```sql
SHOW DATABASES LIKE 'nf\_%';
SELECT tenant_code, db_name FROM nf_master.tenant_master;
SELECT COUNT(*) FROM nf_devco.location_master WHERE location_type = 'SILO';
```

Expect `nf_master`, `nf_system` and `nf_devco`; tenants `devco → nf_devco` and
`system → nf_system`; and 53 silos.

### Retiring the pre-`nf_` databases

Servers set up before 24 September hold NAVFarm's data under the old names.
Once the `nf_` deployment is verified (section 9), list which old databases
were NAVFarm's:

```sql
SELECT tenant_code, db_name FROM navfarm_master.tenant_master;
```

Only `navfarm_master` and the `db_name`s it lists are NAVFarm's. Back them up
with `mysqldump` if the old data may be wanted, then drop those — by name, one
at a time. **Leave every other `tenant_*` database alone**: it is not in
NAVFarm's list and may belong to the other application.

## 5. Production builds

```powershell
pnpm nx run api:build --skipNxCache
pnpm nx run web:build --skipNxCache
```

The API output is `apps/api/dist/main.js`; the web output is `apps/web/.next`.

## 6. Interactive production startup

Before starting, verify no stale process owns either application port:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 2877,3002 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Open two PowerShell windows in the repository root.

API window:

```powershell
pnpm nx run api:start
```

This starts `node apps/api/dist/main.js` with production environment, binds the
API to `127.0.0.1:2877`, and does not enable the Node inspector.

Web window:

```powershell
pnpm nx run web:start
```

This runs Next.js with explicit `--hostname 0.0.0.0 --port 3002`. It does not
inherit a generic `PORT` value from the API environment.

## 7. Health and localhost verification

Run from a third PowerShell window on the server:

```powershell
# Direct private API health.
Invoke-RestMethod http://127.0.0.1:2877/api/v1/health

# The same health route through the public-facing Next.js origin/proxy.
Invoke-RestMethod http://127.0.0.1:3002/api/v1/health

# Web page and API documentation.
(Invoke-WebRequest http://127.0.0.1:3002 -UseBasicParsing).StatusCode
(Invoke-WebRequest http://127.0.0.1:2877/api/docs -UseBasicParsing).StatusCode

# Confirm the intended bindings/PIDs.
Get-NetTCPConnection -State Listen -LocalPort 2877,3002 |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Both health requests must return `status: ok`. Startup output must not contain
`Debugger listening` and nothing should listen on 9229:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 9229 -ErrorAction SilentlyContinue
```

## 8. Windows Firewall

For the initial direct-port test deployment, create one inbound application
rule in an elevated PowerShell window:

```powershell
New-NetFirewallRule `
  -DisplayName "NAVFarm Test Web 3002" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3002
```

Where tester addresses are known, add `-RemoteAddress` with those addresses or
networks. Do not add NAVFarm rules for 2877, 3306, 33060, 6379, or 9229. The
existing restricted RDP rule for 9296 is separate and should not be changed.

## 9. Public verification

From a computer outside the RDP server, open:

```text
http://103.234.185.14:3002
```

Then sign in and exercise at least one read and one safe write. Browser network
requests should target `http://103.234.185.14:3002/api/v1/...`, never port 2877.

## 10. Safe restart and update

After interactive verification, stop the API and web processes gracefully
with `Ctrl+C` in their own windows. For an update:

1. Back up the NAVFarm MySQL databases if server data must be retained.
2. Confirm both processes are stopped and ports 2877/3002 are free.
3. Run `git status --short`; preserve and review any server-only changes.
4. Run `git fetch origin`, `git switch main`, and
   `git pull --ff-only origin main`.
5. Run `pnpm install --frozen-lockfile`.
6. Back up the `nf_` databases (section 13), then run `pnpm nx run api:db-bootstrap`
   **and** `pnpm nx run api:db-migrate-all-tenants`. Bootstrap migrates only
   `nf_master` and `nf_system`; the tenant databases (`nf_<tenant>`, where the
   testers' data lives) are migrated only by the second command. Only when the
   release says the demo must be rebuilt and the data is disposable, rebuild it
   with section 4 instead (dry run first, then `--apply`).
8. Rebuild API and web with the commands in section 5.
9. Start API first, verify direct health, then start web and verify proxied health.

`db-rebuild-demo -- --apply` drops and rebuilds every `nf_` database, so never
run it where data must be kept.

## 11. Persistent processes after interactive testing

Do not keep a shared test server alive through open RDP terminals. After the
commands above pass interactively, register two separate Windows services using
an approved service wrapper such as WinSW/NSSM, or use two Task Scheduler tasks
configured to run whether the administrator is logged in or not.

Each process must have:

- repository root as its working directory;
- its own command (`pnpm nx run api:start` or `pnpm nx run web:start`);
- automatic restart on failure;
- separate stdout/stderr log files;
- startup order with API before web;
- a service account that can read the checkout and environment files, write the
  uploads/log directories, and connect to local MySQL.

Validate the same direct and proxied health checks after converting the
interactive commands into services.

## 12. Updating the running services (NSSM)

The server runs two NSSM services behind IIS: `NAVFarm-API` (port 2877) and
`NAVFarm-Web` (port 3002, published as https://test-app.navfarm.com).
`NAVFarm-Web` depends on `NAVFarm-API`.

**Stop both services before building.** `next build` replaces
`apps/web/.next` in place and renames every chunk under `/_next/static`. A web
service left running during the build serves a mix of old and new files, and
testers get `ChunkLoadError … 500` and "Application error: a client-side
exception". The services also keep `dist/` and `.next` files locked on Windows.
About three minutes of planned downtime is the price of a clean switch.

Run in an **Administrator** PowerShell:

```powershell
Set-Location C:\Users\rishi.gurung\Desktop\navfarm

# 1. Stop web first (it depends on the API), then the API.
Stop-Service NAVFarm-Web
Stop-Service NAVFarm-API
Get-Service NAVFarm-Web, NAVFarm-API          # both Stopped
Get-NetTCPConnection -State Listen -LocalPort 2877,3002 -ErrorAction SilentlyContinue   # prints nothing

# 2. Update the code.
git status --short                             # must print nothing
git fetch origin
git pull --ff-only origin main
git log -1 --oneline
pnpm install --frozen-lockfile

# 3. Database: back up (section 13), then keep the data and apply new migrations.
#    Bootstrap migrates nf_master and nf_system only; the second command migrates
#    every tenant database. Read its output: a tenant that prints FAILED still
#    lets the command exit 0.
pnpm nx run api:db-bootstrap
pnpm nx run api:db-migrate-all-tenants
#    … or, only when the release says the demo must be rebuilt (drops every nf_ database):
#    pnpm nx run api:db-rebuild-demo            (dry run, read it)
#    pnpm nx run api:db-rebuild-demo -- --apply

# 4. Build while nothing is running.
pnpm nx run api:build --skipNxCache
pnpm nx run web:build --skipNxCache

# 5. Start the API, check it, then start web and check through IIS.
Start-Service NAVFarm-API
Start-Sleep 5
Invoke-RestMethod http://127.0.0.1:2877/api/v1/health
Start-Service NAVFarm-Web
Start-Sleep 10
(Invoke-WebRequest http://127.0.0.1:3002 -UseBasicParsing).StatusCode
Invoke-RestMethod https://test-app.navfarm.com/api/v1/health
```

If a build fails, fix it before starting either service. Do not start the old
build against the new code.

Testers who had the site open during the update may see one automatic reload:
the page script `chunk-reload-script.ts` reloads a tab once when its chunks no
longer exist. If a page still shows "Application error" after that, ask for a
hard refresh (Ctrl+Shift+R) and a screenshot of the browser console.

## 13. Releases with tenant migrations: backup, check, recover

The Feed Forecast release (tenant migrations 0114, 0115 and 0116) was rehearsed
on a copy of a demo tenant rolled back to the server's state (0113). Row counts
and table checksums were unchanged apart from the tables the migrations exist
to change (`silo_shed_link` created and filled from `feed_silo_id`,
`feed_silo_id` dropped, two farm columns added, feed rows moved to stage days),
and a second run applied nothing. The steps below are what made that safe.

**Before stopping anything, record the starting point** (MySQL, read-only):

```sql
SELECT tenant_code, db_name FROM nf_master.tenant_master;
-- for each db_name:
SELECT COUNT(*), MAX(created_at) FROM nf_<code>.__drizzle_migrations;          -- 114, 1790444400000 before this release
SELECT COUNT(*) FROM nf_<code>.location_master WHERE feed_silo_id IS NOT NULL;  -- note it: the link count must equal it
```

Stop if any tenant is not at the same starting point.

**Back up only the NAVFarm databases**, after the services are stopped and before
any migration. This MySQL is shared, so never `--all-databases`. PowerShell's
`>` writes UTF-16 and corrupts a dump; use `--result-file`:

```powershell
$ts = Get-Date -Format yyyyMMdd-HHmm
New-Item -ItemType Directory -Force C:\navfarm-backups | Out-Null
git rev-parse HEAD > "C:\navfarm-backups\prev-commit-$ts.txt"
mysqldump -u root -p --single-transaction --routines --triggers --events --no-tablespaces `
  --set-gtid-purged=OFF --default-character-set=utf8mb4 `
  --databases nf_master nf_system nf_<code1> nf_<code2> `
  --result-file="C:\navfarm-backups\nf-$ts.sql"
Select-String -Path "C:\navfarm-backups\nf-$ts.sql" -Pattern '^-- Dump completed' | Select -First 1
```

List every `db_name` from the query above. The last line must print
`-- Dump completed`.

**After `db-migrate-all-tenants`**, for each tenant:

```sql
SELECT COUNT(*), MAX(created_at) FROM nf_<code>.__drizzle_migrations;   -- 117, 1790703600000
SELECT COUNT(*) FROM nf_<code>.silo_shed_link;                            -- = the feed_silo_id count noted before
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema='nf_<code>' AND table_name='location_master' AND column_name='feed_silo_id';  -- 0
```

Then, after starting the services, sign in as a tester and check that a
batch and a goods receipt from before the update are still there, that
Locations and a silo's attached sheds load, and that Inventory → Feed Forecast
opens for a farm.

**If a migration fails part-way.** MySQL commits DDL statement by statement, so
a crash can leave half a migration behind, and every re-run then stops on it.
No data is lost: the links are copied before `feed_silo_id` is dropped.

- `Table 'silo_shed_link' already exists` (0114 died part-way): `DROP TABLE silo_shed_link;`
  and, if it was added, `ALTER TABLE location_master DROP COLUMN feed_refill_buffer_days;`,
  then re-run `db-migrate-all-tenants`.
- `Can't DROP 'location_master_feed_silo_id_fk'` (0115 died part-way): put back
  what 0115 removed, then re-run:
  ```sql
  ALTER TABLE `location_master` ADD CONSTRAINT `location_master_feed_silo_id_fk`
    FOREIGN KEY (`feed_silo_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;
  ```
  (and `CREATE INDEX idx_location_master_feed_silo_id ON location_master (feed_silo_id);`
  if the index is gone too).
- When in doubt, and before testers have entered new data, restore the backup
  (services stopped): `cmd /c "mysql -u root -p < C:\navfarm-backups\nf-<ts>.sql"`,
  then `git reset --hard <prev-commit>`, install, build and start.

**Rolling back after testers have entered new data**: do not restore the backup,
which would lose their entries. Ask for the down migration, which puts
`feed_silo_id` back from the links and was tested to reproduce the old state
exactly (a shed with several silos keeps the lowest).

### Plan S release (tenant migrations 0122–0126)

What it changes on testers' data, and what it leaves alone (rehearsed on a
server-like copy, `.superpowers/sdd/2026-09-27-feed-forecast-s-fixes/migration-rehearsal.md`):

- **0122** adds `approval_request.farm_id` and `document_id` (feed requisitions are
  approved in the Approvals inbox) and fills them on the feed requisitions already
  decided. It is DDL: see "If 0122 fails part-way" below. Other document types keep
  both columns empty.
- **0123** sets a batch's shed only where its live animals, or its scheduler
  headers, name exactly one shed of its own company and farm. A shed someone chose
  is never changed; ambiguous batches keep "no shed on record".
- **0124** gives a silo without feed levels High = 90 % and Low = 20 % of its
  capacity. A level someone set is never changed. A silo where the default would
  break low < high keeps that level empty, and the form asks for it.
- **0125** fills an empty duration on DRY_SOW (7), FLUSH (14), FARROWING (3) and
  WEANING (1), and an empty next stage on WEANER → GROWER → FINISHER. System stages only.
- **0126** clears the stale `storage_type = 'SILO'` on pens, sheds and crates loaded
  from the old location template, which made every save of them demand a silo
  capacity. Silos and stores keep theirs; no other column is touched.

**Before stopping anything**, for each tenant database (read-only):

```sql
SELECT COUNT(*), MAX(created_at) FROM nf_<code>.__drizzle_migrations;   -- note it; the release adds 5 rows
-- What the release will fill, kept so it can be told apart from later edits:
SELECT location_id, location_code FROM nf_<code>.location_master
 WHERE location_type='SILO' AND (low_level_kg IS NULL OR high_level_kg IS NULL);
SELECT stage_id, stage_code, company_id FROM nf_<code>.stage_master
 WHERE is_system=1 AND ((typical_duration_days IS NULL AND stage_code IN ('DRY_SOW','FLUSH','FARROWING','WEANING'))
    OR (next_stage_id IS NULL AND stage_code IN ('WEANER','GROWER')));
SELECT batch_id, batch_no FROM nf_<code>.batch_header WHERE shed_id IS NULL AND deleted_at IS NULL;
SELECT location_id, location_code, location_type FROM nf_<code>.location_master
 WHERE storage_type='SILO' AND location_type NOT IN ('SILO','STORE');
```

Save the four lists to `C:\navfarm-backups\plan-s-fill-$ts.txt`, then back up as above.

**After `db-migrate-all-tenants`**, for each tenant:

```sql
SELECT COUNT(*), MAX(created_at) FROM nf_<code>.__drizzle_migrations;   -- +5 rows, 1791567600000
SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='nf_<code>'
  AND table_name='approval_request' AND column_name IN ('farm_id','document_id');   -- 2
SELECT COUNT(*) FROM nf_<code>.location_master WHERE location_type='SILO'
  AND (low_level_kg IS NULL OR high_level_kg IS NULL);   -- only silos where a tester's level blocks the default
SELECT COUNT(*) FROM nf_<code>.location_master
  WHERE storage_type='SILO' AND location_type NOT IN ('SILO','STORE');   -- 0
```

Then sign in as a tester: open Inventory → Feed Forecast (the page does not scroll,
the table does), Inventory → Requisitions, the Alerts page (feed alerts are listed
there now) and Approvals. Check that a tester's batch, goods receipt and silo from
before the update are unchanged.

**If 0122 fails part-way** (`Duplicate column name 'farm_id'` on a re-run): MySQL
committed the first ALTER. Put back what it added, then re-run:
`ALTER TABLE approval_request DROP COLUMN farm_id;` (and `DROP COLUMN document_id`,
`DROP INDEX idx_approval_request_farm`, `DROP INDEX idx_approval_request_document`
for whichever of those exist). 0123–0126 change data only and roll back whole on a
failure, so a re-run is enough. Rehearsed: the forced failure left `farm_id` behind
and the journal at its old count, and the drop-and-re-run finished the release.

**Rolling back after testers have entered data**: do not restore the backup. The
fills are defaults testers can edit; the lists saved above show which rows the release
filled. 0122 can be reversed with the four statements above plus
`DELETE FROM __drizzle_migrations WHERE created_at >= 1791222000000;`, once the
previous build is back in place.

Never run `db-rebuild-demo`, `setup-fresh-database` or any seed script on this
server: they replace the testers' data.

