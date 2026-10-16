-- The application accesses PostgreSQL only through its server-side Prisma
-- connection. No browser or Supabase Data API client needs direct table access.
-- Keep Prisma-owned tables private from Data API roles while allowing the
-- database owner used by the application and migrations to continue operating.

DO $migration$
DECLARE
  table_name text;
  api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Account',
    'AuditLog',
    'Invitation',
    'RateLimit',
    'Session',
    'User',
    'Verification',
    '_prisma_migrations',
    'app_settings',
    'census_records',
    'line_deliveries',
    'line_worker_state',
    'verified_line_groups'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH table_name IN ARRAY ARRAY[
        'Account',
        'AuditLog',
        'Invitation',
        'RateLimit',
        'Session',
        'User',
        'Verification',
        '_prisma_migrations',
        'app_settings',
        'census_records',
        'line_deliveries',
        'line_worker_state',
        'verified_line_groups'
      ]
      LOOP
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
          table_name,
          api_role
        );
      END LOOP;

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$migration$;
