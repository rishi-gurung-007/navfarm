# Deploying a NAVFarm demo (TiDB Cloud + Railway + Vercel)

A runbook for standing up a real, hosted demo of the current build — TiDB
Cloud Serverless for the database, Railway for the NestJS API, Vercel for
the Next.js web app. No demo/fake tenant is created anywhere in this flow;
you sign up through the real app once it's live to create the actual
tenant/company.

Each step below is manual (account creation, clicking "deploy", pasting
secrets) — none of it can be scripted from here.

## 1. Create the TiDB Cloud Serverless cluster

1. Sign up / log in at [tidbcloud.com](https://tidbcloud.com), create a
   **Serverless** cluster (free tier is fine for a demo).
2. Open the cluster's **Connect** dialog, select the "General" connection
   type, and copy: host, port (`4000`), username (format
   `<user>.<cluster-id>`), and generate/copy a password.
3. TiDB Cloud Serverless requires TLS — no separate CA file is needed, it
   uses a publicly-trusted certificate.

## 2. Run migrations + reference-data seeding against TiDB

From your machine (or wherever you run `pnpm` against this repo), set these
env vars (see `apps/api/.env.example` for the full list — at minimum you
need the `DATABASE_*` block below plus `JWT_SECRET`, `ENCRYPTION_KEY`,
`SYSTEM_TENANT_DATABASE`, `SYSTEM_ADMIN_*`):

```sh
export DATABASE_HOST=gateway01.<region>.prod.aws.tidbcloud.com
export DATABASE_PORT=4000
export DATABASE_USERNAME=<user>.<cluster-id>
export DATABASE_PASSWORD=<cluster password>
export DATABASE_NAME=navfarm_master
export DATABASE_SSL=true
```

Then, from `apps/api`, run the trimmed fresh-setup flow:

```sh
pnpm nx run api:db-fresh-setup
```

This drops+recreates the platform/system databases, runs migrations, and
seeds only non-tenant reference data (NOB/LOB taxonomy, locales, UOMs,
species, breeds, stages, items). **No tenant is created** — the script
prints the platform super-admin login (from `SYSTEM_ADMIN_EMAIL` /
`SYSTEM_ADMIN_PASSWORD`) and stops there.

If you'd rather not drop/recreate on a shared cluster, run the individual
steps instead: `db-bootstrap`, `db-sync-nob-lob`, `db-sync-locale-master`,
`db-seed-system-master-data` (all `pnpm nx run api:<target>`).

## 3. Deploy the API to Railway

1. New Railway project → deploy from this repo, **root directory**
   `apps/api`.
2. Build command: `pnpm nx build api`. Start command:
   `node --env-file-if-exists=.env dist/main.js` from `apps/api` — the checked-in
   Nx build writes `main.js` there.
3. Set every var from `apps/api/.env.example` as a Railway env var, using
   the real TiDB credentials from step 1 (`DATABASE_SSL=true`) and:
   - `NODE_ENV=production`
   - `PORT` — Railway sets this automatically; `main.ts` already reads
     `process.env.PORT`, don't override it.
   - `CORS_ORIGINS` — leave a placeholder for now (e.g.
     `https://placeholder.vercel.app`), you'll fix this in step 5.
4. Deploy. Once live, copy the Railway-assigned public URL (e.g.
   `https://navfarm-api-production.up.railway.app`).

## 4. Deploy the web app to Vercel

1. New Vercel project → import this repo, **root directory** `apps/web`.
   Framework preset should auto-detect as Next.js.
2. Set the server-only env vars from `apps/web/.env.example`:
   - `NAVFARM_API_MODE=proxy`
   - `NAVFARM_API_UPSTREAM_URL=https://<railway-api-domain>`
   Browser requests remain same-origin at `/api/v1`; the Next.js server proxies
   them to Railway.
3. Deploy. Copy the resulting Vercel URL (e.g.
   `https://navfarm.vercel.app`).

## 5. Close the loop on CORS

Go back to Railway and update `CORS_ORIGINS` to include the real Vercel
URL from step 4, then redeploy the API service so the change takes effect.

## 6. Create your real demo tenant

Visit the Vercel URL and sign up through the app's actual onboarding flow.
This creates a real tenant/company backed by real data — nothing here was
seeded. From there, log in as the platform super-admin (credentials printed
at the end of step 2) if you need to manage tenants/plans first.

## Not covered here

- Redis and Cloudflare R2 — neither is wired into the codebase yet, so the
  demo works without them. Add them later if a feature needs them.
- A Dockerfile — Railway's Nixpacks auto-build was assumed sufficient for
  this Nx workspace. If Nixpacks fails to detect the app correctly, a
  Dockerfile for `apps/api` may be needed — not written here since it's
  unverified whether it's actually necessary.
