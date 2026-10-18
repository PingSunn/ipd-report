# Database backup and recovery

IPD owns the backup job; the NAS only accepts S3 objects. The recovery boundary
is the complete PostgreSQL `public` schema: application users and Better Auth
data, census records, audit history, settings, and Prisma migration history.
Supabase-managed schemas (`auth`, `storage`, `realtime`, and others), Storage
files, provider configuration, and external secrets are not included.

The backup archive uses PostgreSQL's compressed custom format inside a versioned
AES-256-GCM encrypted package. Counts are captured from the same exported
read-only snapshot as `pg_dump`. Uploads use multipart parts below the public
endpoint's request limit. A complete remote read-back checksum must match before
expired backup objects can be pruned. A successful upload is not proof of a
successful restore: run the isolated restore verification before enabling the
schedule and repeat it periodically.

The current implementation caps the encrypted package at 512 MiB, on both
creation and download. An oversized backup fails before upload or retention
pruning. Monitor growth and review the limit and temporary-storage budget before
the compressed archive approaches that threshold.

Archives intentionally omit ownership and ACLs. Before resuming an application
after a real disaster recovery, explicitly re-provision the reviewed runtime
role/grants and restore its external secrets/configuration. A disposable
verification target bootstraps `ipd_app` as `NOLOGIN`; it is not a ready-to-serve
replacement production database.

## Secrets and identities

Keep these in the application's Infisical `prod` environment, at `/`. The
Infisical operator materializes `ipd-report-env`; the CronJob selects only its
individual backup keys. Do not add `envFrom` or mount them into web/LINE pods.

| Setting | Purpose |
| --- | --- |
| `BACKUP_DATABASE_URL` | Dedicated read-only backup role through a session pooler, not a transaction pooler |
| `BACKUP_DATABASE_CA_CERT` | Optional PEM CA from the provider dashboard; required for Supabase's private root CA |
| `BACKUP_ENCRYPTION_KEY` | Cryptographically random 32 bytes, base64 encoded |
| `BACKUP_S3_ENDPOINT` | HTTPS S3-compatible endpoint |
| `BACKUP_S3_REGION` | Signing region supported by the endpoint |
| `BACKUP_S3_BUCKET` | Private backup bucket |
| `BACKUP_S3_PREFIX` | Nonempty, application-specific prefix ending in `/` |
| `BACKUP_S3_FORCE_PATH_STYLE` | `true` for the RustFS endpoint |
| `BACKUP_S3_ACCESS_KEY_ID` | Dedicated prefix-scoped S3 identity |
| `BACKUP_S3_SECRET_ACCESS_KEY` | That identity's secret |

The storage identity requires object put/get/delete, multipart abort/part listing,
and prefix-conditioned bucket listing. It does not require bucket creation,
policy changes, or access to another application's prefix. Never use root.

Remote PostgreSQL connections must verify the certificate and hostname, not
merely request encryption. Obtain the project's CA through Database Settings
and store its PEM as `BACKUP_DATABASE_CA_CERT`. Do not work around a private-CA
error by setting `rejectUnauthorized: false` or downgrading `sslmode`. Local
disposable restore targets are the only connections that disable TLS.
Import PEM through a multiline editor or the Infisical CLI's
`BACKUP_DATABASE_CA_CERT=@/path/to/provider-ca.crt` file-import syntax. Verify the
stored value preserves actual newlines rather than literal escaped `\n` text.

Retain a recovery copy of the encryption key in an independent password manager
or offline store controlled by the owner. Keeping a key only beside its archive
on the NAS is not recovery. Preserve old keys for all archives still encrypted
under them; changing the current key does not re-encrypt old backups. Do not
commit keys, database URLs, dumps, or recovery artifacts, or put them in CI logs.

Owner access is needed only to provision the separate backup database role;
provisioning is an explicit database change, not a step that runs during backup.
Use `scripts/db/provision-backup-role.ts` with owner `DIRECT_URL` and the backup
password supplied through the environment, then store its session-pooler URL as
`BACKUP_DATABASE_URL`. Review the script before running it on the hosted project.
The role can read all public tables and sequences, including rows hidden by RLS,
but must not own schemas/tables or have write, role-creation, database-creation,
or replication privileges. RLS bypass is intentional for complete recovery and
must not be granted to the normal application role.

## Initial verification and rollout

With the required environment variables injected securely, the local entry
points are:

```sh
bun run db:backup
# BACKUP_OBJECT_KEY selects the archive; RESTORE_DATABASE_URL must name an empty
# disposable localhost database, never a hosted application database.
bun run db:restore-check
```

When using the dedicated image for recovery, override its normal backup command:
`--entrypoint bun <backup-image> scripts/backup/restore.ts`. Pass environment
variables by name or mounted secret files, not literal credentials on command
lines. Do not export all Infisical secrets into a reusable plaintext file.

1. Build the dedicated Docker target `backup`. Its PostgreSQL 18 client can dump
   the current PostgreSQL 17 source; restore with PostgreSQL 18 or a compatible
   tested target. PostgreSQL does not guarantee restoring a newer client's dump
   into an older server.
2. Populate the backup-only secrets. Verify source project identity and TLS.
   For the initial one-off verification only, an owner connection may be used
   read-only; do not persist it as the scheduled workload's identity.
3. Run one backup. Record its object key, encrypted-package checksum, and success
   status without recording credentials or row contents.
4. Restore into an empty, disposable localhost database. Never use the source URL
   or an existing application database as the restore destination. The verifier
   rejects a non-local endpoint and an existing public schema with user objects;
   it does not clean or overwrite a populated target. Policy role dependencies
   must exist as unprivileged `NOLOGIN` roles in this isolated target.
5. Verify every public table's restored count against the encrypted snapshot
   manifest. Authentication or checksum failures must stop before importing any
   SQL. Check failed restore transactions and destroy the disposable test target
   after recording only the verification result.
   When comparing PostgreSQL 17 and 18 catalogs, compare NOT NULL columns
   separately: PostgreSQL 18 also records them in `pg_constraint`, so raw
   constraint counts across those versions are not directly comparable. See
   the [PostgreSQL 18 release notes](https://www.postgresql.org/docs/18/release-18.html).
6. Review/publish the backup image and pin its multi-architecture digest in the
   GitOps application's image configuration. Deploy the CronJob suspended, run a
   one-off job, verify its result, and only then change `suspend` to `false` in
   reviewed GitOps state. Do not manually edit an Argo-managed CronJob.

The configured schedule is `0 3 * * *` with `timeZone: Asia/Bangkok` and a
14-day retention window. `concurrencyPolicy: Forbid`, a start deadline, bounded
retries, and an active deadline prevent overlapping or unbounded jobs. CronJobs
are not exactly-once execution; inspect success state rather than assuming that
03:00 produced a backup. No schedule runs while `suspend: true`.

## Failure visibility

The process exits unsuccessfully for dump, encryption, upload, verification, or
retention failures. Job history and logs are the immediate diagnostic surface.
Optional Prometheus rules live in `deploy/monitoring/` for failed jobs and stale
successful backups; install them only where Prometheus Operator is available
and verify its selectors and Alertmanager notification routing. The ward's LINE
report destination is deliberately not reused for infrastructure alerts.

Daily backups have an approximately 24-hour recovery-point gap, potentially
longer after a failed or missed job. They do not replace PITR. RustFS on one NAS
is one recovery location: add an independent off-site copy for NAS loss or
ransomware resilience. A storage credential with retention-delete rights can
delete its backups; encryption alone does not prevent deletion.
