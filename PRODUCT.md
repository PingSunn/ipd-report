# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, React, strict TypeScript, bun, Tailwind CSS v4, and shadcn/ui. Confirmed for the rebuild.

## Product Purpose

Record inpatient census totals by shift and produce shift handover reports for Ongkharak Hospital.

## Operating Context

Support mobile and desktop. Preserve the existing Thai interface and morning, afternoon, and night shifts.

## Capabilities and Constraints

Preserve census entry, editing, deletion, shift overview, historical records, analytics, patient categories 1–5, nursing workload calculations, CSV export, and editable LINE summary text copied to the clipboard.

The pre-rebuild implementation used an Express API backed by a JSON file, native Google Apps Script calls, and browser localStorage fallback. The rebuilt application uses Next.js API routes and PostgreSQL and removes Google Apps Script compatibility. Start with an empty database; there is no legacy data to migrate. A successful save requires confirmation from PostgreSQL. Offline persistence and synchronization are out of scope.

Use PostgreSQL hosted on Supabase for the shared database and a dedicated Docker PostgreSQL instance during local development. Google sign-in is invitation-only. Nurses can read and update shared census records and prepare LINE summaries; ward heads additionally manage deletion, export, analytics, Settings, LINE automation, invitations, roles, and account status.

## Users

Both ward nurses and ward heads use the application. Nurses record and edit shared shift census totals, review history, and prepare handover messages. Ward heads manage the same shared data plus analytics, exports, destructive actions, system configuration, LINE automation, and user access. The last active ward head cannot be demoted or suspended.

## Authentication and audit

Better Auth uses the shared OKR Unit Google OAuth client. Only verified Google
accounts with an unexpired seven-day invitation may join; the bootstrap ward
head is configured explicitly with `AUTH_BOOTSTRAP_EMAIL`. Provider access,
refresh, and ID tokens are discarded after Google verifies the sign-in because
the application does not call Google APIs. Sessions last 14 days, while protected
requests recheck the user's active status and role. Census and administration
changes write immutable audit entries with actor and relevant before/after
state. The signed LINE webhook and direct-database LINE worker remain machine
boundaries outside human sessions.

## Evidence on Hand

The pre-rebuild React components and Express server are preserved in Git history as the functional baseline. The current implementation lives in src/, with database schema and migrations in prisma/. The database starts empty; temporary QA records are cleaned up after tests.

## Shared Settings and Scheduled LINE Delivery

Confirmed extension: a shared Settings page controls hospital and ward names,
default bed capacity for new records, report format and sections, the LINE group,
and reporting times. Noto Sans Thai replaces Sarabun throughout the interface.

Automatic reports run from an independent server worker in Asia/Bangkok.
Defaults follow the existing shift ends: night at 08:00, morning at 16:00,
and afternoon at 00:00 the next day, referring to the preceding report date.
When a due shift has no census, send one missing-data notice. After downtime,
consider only the latest due shift rather than replaying the backlog.

The owner has created a LINE Official Account. Channel credentials live in
server environment variables. Automatic delivery remains disabled until a
destination is configured and the owner enables it. Provider acceptance does
not prove that individual group members received or read the message.

LINE report bodies use a short reporting-date/shift header, selected census
figures, and an optional LINE-safe note entered separately from the internal
census note. The safe note is blank and disabled by default and must exclude
patient identifiers. Hospital, ward, and reporter names, decorative dividers,
and long section headings are omitted from both copied previews and automatic
reports. Ward identity remains visible in the application itself.
