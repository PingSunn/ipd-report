# Separate runtime and migration database roles

The application and LINE worker use a dedicated least-privilege PostgreSQL role,
while schema-owner credentials remain exclusive to migrations. An idempotent
provisioning script establishes grants before the runtime secret is switched.
This keeps normal operation possible without giving a compromised web workload
RLS bypass, role creation, database creation, or schema ownership privileges.
