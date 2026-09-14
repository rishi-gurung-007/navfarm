# NAVFarm

NAVFarm is an agriculture operations platform organized as an Nx monorepo. The backend, web application, and Flutter application are independent deployable products that share one repository and one task runner. This repository currently contains platform starters only; business and ERP modules should be added deliberately as product requirements are defined.

> **Security:** Never commit `.env` files, credentials, access keys, database passwords, signing certificates, provisioning profiles, or other secrets. Commit only placeholder-only `.env.example` files.

## Technology stack

- Nx 23 with pnpm workspaces
- NestJS 11 backend, with Socket.IO and notifications planned
- Next.js 16, React 19, App Router, and the `src` directory
- Tailwind CSS 4 through the Tailwind PostCSS plugin
- Flutter 3 and Dart for iOS, Android, web, and desktop clients
- MySQL for relational data
- Redis for local caching, queues, and real-time infrastructure
- Cloudflare R2 for S3-compatible object storage
- Jest for API and web unit tests
- Playwright for web end-to-end tests
- ESLint and TypeScript for static checks

## Repository structure

```text
navfarm/
├── apps/
│   ├── api/          # NestJS backend
│   ├── api-e2e/      # API end-to-end tests
│   ├── web/          # Next.js web app (App Router)
│   ├── web-e2e/      # Playwright web tests
│   └── mobile/       # Normal Flutter project (no package.json)
├── packages/         # Future shared workspace packages
├── nx.json
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
└── README.md
```

## Ownership

Rishi leads NAVFarm's product development across the NestJS backend, the Next.js web application, and the Flutter mobile application, carrying features from implementation through day-to-day delivery and production releases.

## Prerequisites

- Node.js `^22.12.0`, `^24.0.0`, or `^26.0.0`. Nx 23 officially supports Node 22.12+, 24, and 26; use an even-numbered LTS release for development and production.
- pnpm 11 (the repository pins `pnpm@11.10.0` in `package.json`).
- Flutter 3.44 or a compatible stable release with Dart 3.12.
- Xcode and CocoaPods for iOS development and release work (macOS only).
- Android Studio and an installed Android SDK for Android development.
- A local or reachable MySQL server.
- A local or reachable Redis server.

Check the local toolchain:

```sh
node --version
pnpm --version
flutter --version
pnpm nx report
```

## Installation

From the repository root:

```sh
pnpm install
pnpm nx reset
pnpm nx show projects
pnpm nx run mobile:pub-get
```

The last command requires Flutter. Flutter remains a normal Dart project under `apps/mobile`; it is not a pnpm package and must not receive a `package.json`.

If pnpm reports ignored dependency build scripts, review the package name and add it to `allowBuilds` in `pnpm-workspace.yaml` only after confirming that its install script is trusted. The currently approved packages are intentionally preserved there.

## Environment files and secrets

The repository contains only templates:

- `.env.example` for shared local port conventions.
- `apps/api/.env.example` for the API, MySQL, authentication, encryption and
  optional email delivery.
- `apps/web/.env.example` for public API/socket URLs and a public R2 URL.

Create local files without committing them:

```sh
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Replace every placeholder locally. Values prefixed with `NEXT_PUBLIC_` are sent to the browser and must never contain secrets. Production values belong in the deployment platform's secret manager, not in Git.

### Cloudflare R2 placeholders

The API template defines these placeholders:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_ENDPOINT
R2_PUBLIC_URL
```

Create an R2 bucket and scoped API token in Cloudflare, keep the secret access key server-side, and configure CORS only for the web origins that need direct browser access. `R2_ENDPOINT` follows `https://<account-id>.r2.cloudflarestorage.com`. Do not expose `R2_SECRET_ACCESS_KEY` through a `NEXT_PUBLIC_` variable.

## Local MySQL and optional Redis

Run MySQL with your preferred local package manager or containers. Redis is not
connected to the application today; the Redis command below is only for future
feature development. Use non-production credentials and a dedicated database.

```sh
docker run --name navfarm-mysql -e MYSQL_ROOT_PASSWORD=local-root-password -e MYSQL_DATABASE=navfarm -p 3306:3306 -d mysql:8
docker run --name navfarm-redis -p 6379:6379 -d redis:7
```

Confirm connectivity before starting features that depend on them:

```sh
mysql -h 127.0.0.1 -P 3306 -u root -p navfarm
redis-cli -h 127.0.0.1 -p 6379 ping
```

The generated API starter does not connect to either service yet. Their environment placeholders establish the intended local convention without inventing persistence modules prematurely.

## Run the applications

### API

The NestJS API listens on `http://localhost:3000/api` by default.

```sh
pnpm dev:api
```

Equivalent Nx command:

```sh
pnpm nx serve api
```

### Web

The root script uses port 3001 so it can run beside the API:

```sh
pnpm dev:web
```

Equivalent Nx command:

```sh
pnpm nx dev web --port=3001
```

Open `http://localhost:3001`.

### Flutter

List devices, fetch Dart packages, and start the interactive device selector:

```sh
flutter devices
pnpm nx run mobile:pub-get
pnpm dev:mobile
```

Useful platform-specific development commands are:

```sh
pnpm nx run mobile:run-ios
pnpm nx run mobile:run-android
```

## Tests, linting, type checks, and builds

Run the common root checks:

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build:api
pnpm build:web
```

Run individual checks:

```sh
pnpm nx test api
pnpm nx test web
pnpm nx lint api
pnpm nx lint web
pnpm nx typecheck api
pnpm nx typecheck web
pnpm nx run mobile:analyze
pnpm nx run mobile:test
```

Run end-to-end projects separately when their browser/runtime prerequisites are available:

```sh
pnpm nx e2e api-e2e
pnpm exec playwright install
pnpm nx e2e web-e2e
```

Build mobile release artifacts:

```sh
pnpm nx run mobile:build-android
pnpm nx run mobile:build-ios-no-codesign
```

The iOS no-codesign target verifies compilation without requiring a distribution identity. Archive and sign through the approved Apple team workflow for a production release.

## Nx project graph

Open the interactive graph:

```sh
pnpm graph
```

Print graph data without opening a browser:

```sh
pnpm nx graph --print
```

Inspect resolved projects and inferred targets:

```sh
pnpm nx show projects
pnpm nx show project api --json
pnpm nx show project web --json
```

## Deployment

### API

Build with `pnpm nx build api`. Deploy the `apps/api/dist` output with a supported Node runtime, inject MySQL and application secrets from the hosting platform, and run database migrations as a separately controlled release step. Redis is not used by the current application. Rishi owns the backend production release.

### Web

Build with `pnpm nx build web`. Deploy the Next.js application independently with its project root set to the monorepo root or with an Nx-aware build command. The browser uses same-origin `/api/v1`; configure the server-only `NAVFARM_API_MODE=proxy` and `NAVFARM_API_UPSTREAM_URL` values so Next.js can reach the private API origin. Rishi owns the web release.

### Mobile

Version, archive, sign, and publish Android and iOS applications through their respective store pipelines. Never put server credentials in the app bundle. Rishi owns application development, signing, and backend-release coordination.

API, web, and mobile releases do not need to share a release cadence, but Rishi coordinates contract changes so deployed client versions remain compatible with the API.

## Troubleshooting

### Nx path errors after moving apps

Clear cached workspace data, then inspect the resolved roots and targets:

```sh
pnpm nx reset
pnpm nx show projects
pnpm nx show project api --json
```

Paths in package targets are resolved from either the workspace root or their declared `cwd`. App-local config imports from `apps/<project>` generally need `../../` to reach root files.

### Incorrect TypeScript `extends` paths

Configs directly under `apps/api`, `apps/web`, `apps/api-e2e`, and `apps/web-e2e` should extend `../../tsconfig.base.json`. Verify with:

```sh
pnpm nx typecheck api
pnpm nx typecheck web
pnpm nx sync:check
```

Do not hide move errors with unrelated TypeScript path aliases.

### pnpm ignored build scripts

pnpm blocks unapproved dependency build scripts. Run `pnpm install` and inspect its warning. If the dependency is required and trusted, add only its exact package name under `allowBuilds` in `pnpm-workspace.yaml`, then reinstall. Do not broadly approve unknown scripts.

### Flutter device detection

```sh
flutter doctor -v
flutter devices
pnpm nx run mobile:doctor
```

Start an Android emulator or connect a device with USB debugging enabled. For iOS, open Simulator or connect an unlocked device and trust the development Mac.

### iOS signing

`mobile:build-ios-no-codesign` intentionally skips signing. For device/archive builds, open `apps/mobile/ios/Runner.xcworkspace` in Xcode, select the approved team and bundle identifier, and ensure certificates and provisioning profiles are available. Do not commit signing credentials.

### Port conflicts

API defaults to 3000 and the root web script to 3001. Find the process already using a port and stop it, or provide another port:

```sh
lsof -i :3000
PORT=3100 pnpm dev:api
pnpm nx dev web --port=3101
```

Update the local web environment URL when the API port changes.

### Next.js workspace-root warning

The web config pins Turbopack's root to this repository. If a warning returns, confirm `apps/web/next.config.js` still resolves `../..` and that no lockfile was accidentally added inside an app.

## Maintainer start commands

Rishi:

```sh
pnpm dev:api
pnpm dev:web
pnpm nx run mobile:pub-get
pnpm dev:mobile
```

Run `pnpm install` once after dependency or lockfile changes.
