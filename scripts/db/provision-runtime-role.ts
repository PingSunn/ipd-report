import { Client } from 'pg';

const runtimeRole = process.env['RUNTIME_DB_ROLE'] ?? 'ipd_app';
const runtimePassword = process.env['RUNTIME_DB_PASSWORD'];
const directUrl = process.env['DIRECT_URL'];
const ownerRoleOverride = process.env['DB_OWNER_ROLE'];

const runtimeCrudTables = [
  'Account',
  'Invitation',
  'RateLimit',
  'Session',
  'User',
  'Verification',
  'app_settings',
  'census_records',
  'line_deliveries',
  'line_webhook_events',
  'line_worker_state',
  'verified_line_groups',
] as const;

const runtimeAppendOnlyTables = ['AuditLog'] as const;
const runtimeTables = [...runtimeCrudTables, ...runtimeAppendOnlyTables] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requireRoleName(value: string, variableName: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${variableName} must be a lowercase PostgreSQL role name`);
  }
  return value;
}

if (!directUrl) throw new Error('DIRECT_URL is required');
if (!runtimePassword) throw new Error('RUNTIME_DB_PASSWORD is required');
const password = runtimePassword;

const role = requireRoleName(runtimeRole, 'RUNTIME_DB_ROLE');
const ownerOverride = ownerRoleOverride
  ? requireRoleName(ownerRoleOverride, 'DB_OWNER_ROLE')
  : undefined;
const roleIdentifier = quoteIdentifier(role);

const client = new Client({ connectionString: directUrl });

async function main(): Promise<void> {
  await client.connect();
  try {
    await client.query('BEGIN');

    const currentUserResult = await client.query<{ current_user: string; current_database: string }>(
      'SELECT current_user, current_database()',
    );
    const currentUser = ownerOverride ?? currentUserResult.rows[0]?.current_user;
    const database = currentUserResult.rows[0]?.current_database;
    if (!currentUser || !database) throw new Error('Unable to resolve database owner');

    const ownerIdentifier = quoteIdentifier(currentUser);
    const databaseIdentifier = quoteIdentifier(database);
    const passwordLiteral = quoteLiteral(password);

    await client.query(`
      DO $provision$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN
          EXECUTE 'CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
        END IF;
      END
      $provision$;
    `);
    await client.query(`
      ALTER ROLE ${roleIdentifier}
        WITH LOGIN CONNECTION LIMIT 20 PASSWORD ${passwordLiteral}
    `);
    const roleAttributes = await client.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname = ${quoteLiteral(role)}
    `);
    const attributes = roleAttributes.rows[0];
    if (
      !attributes ||
      attributes.rolsuper ||
      attributes.rolcreatedb ||
      attributes.rolcreaterole ||
      attributes.rolinherit ||
      attributes.rolreplication ||
      attributes.rolbypassrls
    ) {
      throw new Error(`${role} has unsafe role attributes; an administrator must revoke them before provisioning`);
    }
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${roleIdentifier}`);
    await client.query(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier}`);
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${roleIdentifier}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${roleIdentifier}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${roleIdentifier}`);

    for (const table of runtimeCrudTables) {
      const tableIdentifier = `public.${quoteIdentifier(table)}`;
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tableIdentifier} TO ${roleIdentifier}`);
      // RLS remains enabled as a second boundary. The role gets an explicit
      // policy instead of the dangerous BYPASSRLS attribute.
      await client.query(`ALTER TABLE ${tableIdentifier} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS ${quoteIdentifier('ipd_app_access')} ON ${tableIdentifier}`);
      await client.query(
        `CREATE POLICY ${quoteIdentifier('ipd_app_access')} ON ${tableIdentifier} AS PERMISSIVE FOR ALL TO ${roleIdentifier} USING (true) WITH CHECK (true)`,
      );
    }
    for (const table of runtimeAppendOnlyTables) {
      const tableIdentifier = `public.${quoteIdentifier(table)}`;
      await client.query(`GRANT SELECT, INSERT ON TABLE ${tableIdentifier} TO ${roleIdentifier}`);
      await client.query(`ALTER TABLE ${tableIdentifier} ENABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS ${quoteIdentifier('ipd_app_access')} ON ${tableIdentifier}`);
      await client.query(
        `CREATE POLICY ${quoteIdentifier('ipd_app_access')} ON ${tableIdentifier} AS PERMISSIVE FOR ALL TO ${roleIdentifier} USING (true) WITH CHECK (true)`,
      );
    }
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdentifier}`);

    // Future tables must be reviewed and added to the explicit allowlist above.
    // Revoke stale default grants left by earlier versions of this provisioner.
    await client.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdentifier} IN SCHEMA public
        REVOKE ALL ON TABLES FROM ${roleIdentifier}
    `);
    await client.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdentifier} IN SCHEMA public
        REVOKE ALL ON SEQUENCES FROM ${roleIdentifier}
    `);

    await client.query('COMMIT');
    console.log(`Provisioned runtime role ${role} for ${runtimeTables.length} application tables.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

await main();
