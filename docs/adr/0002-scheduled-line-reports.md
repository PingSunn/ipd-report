# Send scheduled LINE reports from a durable worker

Settings and reporting schedules are shared across nurses and ward heads.
Automatic LINE delivery runs in a separate server worker with PostgreSQL-backed
report slots and immutable message snapshots, rather than relying on an open
browser or a request continuing after a census save. A report slot is unique by
report date and shift so edits or moves of a census record do not resend it.

The owner chose a missing-data notice when a shift has no census, and latest-only
catch-up after downtime. These choices keep the group informed without replaying
old reports. LINE credentials remain server-side; verified webhook events provide
group discovery. Persisted provider retry keys protect retried requests within
LINE's retry window, while acceptance is recorded separately from delivery.
