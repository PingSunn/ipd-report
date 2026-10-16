# IPD Report

Thai inpatient census and shift handover reporting for Ongkharak Hospital.
The application supports nurses and ward heads on mobile and desktop, with
shared shift records, occupancy and patient-category summaries, workload
estimates, historical analytics, CSV export, and editable LINE summary text.

## Stack

Next.js App Router, React, strict TypeScript, bun, Tailwind CSS v4, shadcn/ui,
Prisma 7, and PostgreSQL. Noto Sans Thai is self-hosted through Fontsource.

## Date and select controls

Date fields display Buddhist Era dates as editable `dd/MM/yyyy` with Latin
digits. The calendar popover uses the Thai Buddhist calendar from
`@daypicker/buddhist` 10.0.2 over React Day Picker; the stored and API value stays
date-only ISO `yyyy-MM-dd`. Required fields keep native and inline invalid-date
validation visible, while optional fields expose a conditional clear action.

Option lists use the controlled shadcn/Radix Select primitive with keyboard-safe
44px targets. Settings shows verified LINE Group IDs in a Select and keeps a
manual input fallback for pasted IDs.

## Local development

```sh
bun install
cp .env.example .env
bun run db:up
bun run db:deploy
bun run db:generate
bun run dev
```

The development PostgreSQL instance binds only to `127.0.0.1:45432` and uses a
persistent Docker volume. The database starts empty. To add six clearly marked
mock records covering all three shifts across two safely historical days, stop
the LINE worker, disable automatic LINE delivery in Settings, then run:

```sh
ALLOW_MOCK_CENSUS_SEED=1 bun run db:seed:mock
```

The command accepts only the dedicated Docker database identity on port `45432`,
refuses to overwrite records, and becomes a no-op when the complete mock fixture
already exists. Check that the intended web port is free before starting the application.
If the default port is occupied, run `bun run dev --port <free-port>`.

The application reports a successful save only after the database confirms it.
It does not store census records in browser localStorage or support offline sync.
Google Apps Script is no longer part of the application.

## Authentication and roles

The app uses Better Auth 1.7.7 with Google sign-in. Configure these server-side
variables before starting Next.js:

```sh
BETTER_AUTH_URL=http://localhost:40273
BETTER_AUTH_SECRET=<random value of at least 32 characters>
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:40273,https://ipd.pskwr.com
NEXT_PUBLIC_APP_URL=http://localhost:40273
GOOGLE_CLIENT_ID=<shared OKR Unit client ID>
GOOGLE_CLIENT_SECRET=<IPD client secret>
AUTH_BOOTSTRAP_EMAIL=pongsakorn.wera@gmail.com
```

The shared Google client must allow these redirect URIs:

- `http://localhost:40273/api/auth/callback/google`
- `https://ipd.pskwr.com/api/auth/callback/google`

Ward heads invite Gmail accounts from Settings. Invitations expire after seven
days. Nurses can read and update shared census records, review history, and
prepare LINE summaries. Ward heads additionally delete and export records,
view analytics, manage Settings and LINE automation, and administer access.
The system prevents demotion or suspension of the final active ward head.

The Settings workspace stores the shared ward identity, default bed capacity,
report content, and fixed `Asia/Bangkok` LINE schedule. Scheduled LINE delivery
runs in a separate worker process; start it independently from Next.js with:

```sh
bun run line:worker
```

See [LINE scheduled reporting](docs/line-service.md) for webhook verification,
verified groups, catch-up, retry, and delivery-history behavior. Scheduled
reporting remains disabled until the server token, a verified group, and the
saved setting are all ready.

## Supabase

Set `DATABASE_URL` to the Supabase PostgreSQL runtime connection URL and
`DIRECT_URL` to the direct migration connection URL. Both are server-only
variables; do not use `NEXT_PUBLIC_` prefixes. Apply migrations with
`bun run db:deploy`. See [database setup](docs/database.md).

## Production deployment

Production uses the multi architecture `runner` and `ops` Docker targets,
Infisical managed secrets, and an Argo CD rollout on k3s. See
[production deployment](docs/deployment.md) for the release sequence, required
Supabase and Infisical values, and the `ipd.pskwr.com` ingress setup.

## Checks

```sh
bun run typecheck
bun run build
bun run test
```

`bun run test` runs the Vitest unit, route-validation, scheduling, transport,
report-settings, and Settings checks. Integration suites are gated: set
`LINE_TEST_DATABASE_URL` to a disposable PostgreSQL database before running
them; without it, those tests are skipped. For example:

```sh
LINE_TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:45432/ipd_report bun run test
```

The E2E suite uses the installed
Google Chrome channel, so Google Chrome must be available on the machine. Start
or keep the application server running, then point the suite at it explicitly
when it is not on the default port:

```sh
BASE_URL=http://localhost:40273 bun run test:e2e
```

The Playwright config defaults to `http://localhost:3000` when `BASE_URL` is not
set. It runs API, desktop, and mobile projects serially with one worker. The
mobile project uses the Chrome channel at a 390×844 viewport; this is viewport
emulation, not native mobile OS or device coverage.

The UI suite captures the reviewed surfaces to
`.impeccable/review/{desktop,mobile}{,-entry,-line,-history,-analytics}.png`.
Settings and typography captures use `settings-{desktop,mobile}.png` and
`overview-noto-{desktop,mobile}.png` in the same directory.
Each E2E run creates temporary QA-labelled records: API records use
`QA-TEMP-*` identifiers, while the UI form also creates UUID records with QA
notes. Cleanup blocks remove all of them; the expected final record count is 0
when the database starts empty.

## Runtime configuration

For Supabase, `DATABASE_URL` is the pooled runtime connection and `DIRECT_URL`
is the direct migration connection. Both are server-only variables. Local
development uses the Docker PostgreSQL service on `127.0.0.1:45432`.

The application ships no raster image assets. Noto Sans Thai is self-hosted
through Fontsource and the product mark is the standalone SVG favicon at
`src/app/icon.svg`.

## Access

All human pages and data APIs require an active session. Better Auth endpoints
and the signed LINE webhook remain public protocol endpoints; the LINE worker
continues to access PostgreSQL directly. See
[ADR 0003](docs/adr/0003-invited-google-access-and-rbac.md).
