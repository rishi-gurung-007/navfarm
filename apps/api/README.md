# NAVFarm API

This Nx application contains the NestJS backend imported from
`/Users/nero/Desktop/Navfarm_New/navfarm_backend` and adapted to this workspace.

## Run locally

1. Copy `.env.example` to `.env` and replace every `CHANGE_ME` value.
2. Start MySQL with a user that can create databases.
3. Bootstrap the control-plane and platform-admin databases:

   ```bash
   pnpm nx run api:db-bootstrap
   ```

4. Start the API:

   ```bash
   pnpm nx run api:serve
   ```

The default API URL is `http://localhost:2877/api/v1`, Swagger is at
`http://localhost:2877/api/docs`, and the database-independent liveness route is
`GET http://localhost:2877/api/v1/health`.

For a non-watching production process with no Node inspector, build and start
with `pnpm nx run api:build` followed by `pnpm nx run api:start`.

## Database model

- `navfarm_master` is the SaaS control plane for plans, tenants, subscriptions,
  global languages/currencies, setup steps, NOB/LOB catalogs, and audit events.
- Each tenant has a separate MySQL database named `tenant_<tenant_code>`.
- The bootstrap target creates `navfarm_master` and `tenant_system`, applies the
  checked-in Drizzle migrations, seeds the documented six NOBs and core LOBs,
  and provisions the platform administrator from environment variables.
- New tenant signup applies the checked-in tenant migration before seeding the
  tenant database.

Generate migrations after editing the Drizzle schemas with
`pnpm nx db-generate-master api` or `pnpm nx db-generate-tenant api`. Apply an
already-generated control-plane migration with `pnpm nx db-migrate-master api`.

## Current boundary

The API implements SaaS administration, authentication, onboarding, company
configuration, users/RBAC, localization, notifications, and audit logs. The web
demo's operational workflows are not yet backed by API controllers. See
`BACKEND_COVERAGE.md` for the detailed comparison.

The imported design stores per-tenant database credentials in the control-plane
tenant record. Replace that with a secrets manager or encrypted-at-rest value
before a production deployment.
