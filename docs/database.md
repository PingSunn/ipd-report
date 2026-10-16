# Database

The rebuild stores inpatient census records in PostgreSQL through Prisma 7 and
the `@prisma/adapter-pg` driver adapter. Local development uses the dedicated
PostgreSQL service in `compose.yaml`; the service publishes PostgreSQL only on
`127.0.0.1:45432` and persists its data in the named
`ipd_report_postgres_data` volume.

## Local setup

Copy `.env.example` to `.env`, then start the database:

```sh
cp .env.example .env
docker compose up -d db
docker compose ps db
```

The container is ready when its health status is `healthy`. Apply the checked-in
migrations with:

```sh
bunx prisma migrate deploy
```

For local schema iteration, create a named migration with:

```sh
bunx prisma migrate dev --name describe_change
```

`prisma.config.ts` requires `DIRECT_URL` for CLI commands and migrations. It
never falls back to the pooled runtime URL. Both URLs point at the local
database in the example environment file.

## CensusRecord mapping

`CensusRecord.id` remains a required arbitrary string primary key, so existing
IDs such as `REC-20261014-M` remain valid. `date` is stored as a PostgreSQL
`DATE` and must be converted to and from the UI's `yyyy-MM-dd` string at the API
boundary. `shift` remains the original Thai `ShiftType` string (`เช้า`, `บ่าย`, or
`ดึก`) to preserve the existing client contract.

The numeric census fields and `note` map one-to-one to the original record. The
occupancy and nursing workload calculations remain in `src/utils/censusUtils.ts`;
the database stores their source values rather than derived results. `createdAt`
and `updatedAt` provide persistence timestamps; `updatedAt` is maintained by
Prisma on updates.

The compound unique constraint on `(date, shift)` enforces one census per date
and shift and supports the existing insert-or-update behavior. No legacy JSON
records or fabricated production census data are imported. The auth
migration removes only the six known local mock fixtures by exact ID and note.
Database checks reject negative counts and non-positive capacity.
Overcapacity is valid, and category totals are allowed to differ from
`totalPatients` while staff reconcile a report, matching the existing form's
warning and repair actions.

## Authentication and audit models

`User`, `Session`, `Account`, `Verification`, and `RateLimit` follow Better
Auth's PostgreSQL schema. `User.role` is `nurse` or `ward_head`; `active` is
checked on every protected request. Nullable `firstName`, `lastName`, and
`nickname` fields support profile onboarding; protected application requests
require all three fields, while the profile endpoint remains available to an
authenticated incomplete user. `Invitation` stores normalized email,
role, seven-day expiry, acceptance, and revocation. `AuditLog` records actor,
action, entity, and before/after JSON. Census creator/updater and Settings
updater relations use `ON DELETE SET NULL` so operational history survives an
account removal.

## Adapter runtime

The application should construct `PrismaClient` with `@prisma/adapter-pg` using
`DATABASE_URL` for runtime queries. On Supabase, use its pooled runtime
connection URL and keep `DIRECT_URL` for Prisma migrations. Do not expose either
URL through `NEXT_PUBLIC_` environment variables. Locally, both URLs point to
the Docker database. The generated client is emitted to `src/generated/prisma`
by the schema generator.
