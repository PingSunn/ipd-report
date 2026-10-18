# Application-owned encrypted database backups

IPD owns its backup code, image, schedule, retention, and recovery verification.
The NAS is only an S3-compatible destination, not a scheduler. Backups cover the
complete `public` schema, including Better Auth accounts, census data, audit
history, and Prisma migration history; Supabase-managed schemas and Storage
objects are outside this recovery boundary.

Use a separate nightly CronJob rather than a timer in the web or LINE process.
Encrypt before upload with an authenticated, versioned format and retain the
decryption key in Infisical, independently of the NAS. A dedicated database role
has read-only table/sequence access; it is not the runtime or migration identity.
Any RLS bypass needed to obtain a complete dump does not grant write privileges.
Owner credentials are used only for explicit provisioning and the initial
read-only verification, never mounted into the scheduled backup workload.

Read back and verify a newly uploaded archive before pruning expired backups.
The schedule remains suspended until an isolated restore has passed and a
reviewed image has been deployed. Backups are not point-in-time recovery, a
Supabase platform clone, or an additional off-site copy of the NAS.
