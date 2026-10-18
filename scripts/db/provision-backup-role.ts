import { Client } from 'pg';
import { parseDatabaseUrl } from '../backup/backup-common';

const role = process.env['BACKUP_DB_ROLE'] ?? 'ipd_backup';
const ownerRole = process.env['DB_OWNER_ROLE'];

function identifier(value: string, variable: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error(`${variable} must be a lowercase PostgreSQL role name`);
  return `"${value}"`;
}
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

export function assertDedicatedRoleName(value: string): void {
  if (value === 'postgres' || value === 'ipd_app' || /^(?:pg_|supabase_|rds(?:$|_|admin$))/u.test(value)) {
    throw new Error('BACKUP_DB_ROLE is reserved for a dedicated backup identity');
  }
}

export function provisionDatabaseConnectionOptions(directUrl: string, env: NodeJS.ProcessEnv = process.env): { connectionString: string; ssl: false | { rejectUnauthorized: true; ca?: string } } {
  const database = parseDatabaseUrl(directUrl, 'DIRECT_URL');
  const caCert = env['BACKUP_DATABASE_CA_CERT']?.trim() || undefined;
  if (caCert && (!caCert.includes('-----BEGIN CERTIFICATE-----') || !caCert.includes('-----END CERTIFICATE-----'))) {
    throw new Error('BACKUP_DATABASE_CA_CERT must be PEM encoded');
  }
  return {
    connectionString: database.connectionString,
    ssl: database.local ? false : { rejectUnauthorized: true, ...(caCert ? { ca: caCert } : {}) },
  };
}

async function main(): Promise<void> {
  const directUrl = process.env['DIRECT_URL'];
  const password = process.env['BACKUP_DB_PASSWORD'];
  if (!directUrl) throw new Error('DIRECT_URL is required');
  if (!password) throw new Error('BACKUP_DB_PASSWORD is required');
  const backupPassword = password;
  const roleIdentifier = identifier(role, 'BACKUP_DB_ROLE');
  const ownerIdentifier = ownerRole ? identifier(ownerRole, 'DB_OWNER_ROLE') : undefined;
  const client = new Client({ ...provisionDatabaseConnectionOptions(directUrl), connectionTimeoutMillis: 15_000, statement_timeout: 120_000, query_timeout: 120_000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ current_user: string; current_database: string }>('SELECT current_user, current_database()');
    const currentUser = current.rows[0]?.current_user;
    if (!currentUser) throw new Error('Unable to resolve current database role');
    assertDedicatedRoleName(role);
    if (role === currentUser || (ownerRole && role === ownerRole)) throw new Error('Backup role must not be the owner or current database role');
    const owner = ownerIdentifier ?? identifier(currentUser, 'DB_OWNER_ROLE');
    const database = current.rows[0]?.current_database;
    if (!database) throw new Error('Unable to resolve database');
    const databaseIdentifier = identifier(database, 'database');
    const existing = await client.query<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean; rolinherit: boolean; rolcanlogin: boolean }>(`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles WHERE rolname = ${literal(role)}`);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const memberships = await client.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid WHERE r.rolname = $1 OR g.rolname = $1 LIMIT 1', [role]);
      const owned = await client.query("SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1 UNION ALL SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = $1 UNION ALL SELECT 1 FROM pg_type t JOIN pg_roles r ON r.oid = t.typowner WHERE r.rolname = $1 UNION ALL SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = $1 LIMIT 1", [role]);
      const outsidePublic = await client.query("SELECT 1 FROM information_schema.role_table_grants WHERE grantee = $1 AND table_schema NOT IN ('public', 'pg_catalog', 'information_schema') LIMIT 1", [role]);
      const roleOid = await client.query<{ oid: string }>('SELECT oid::text AS oid FROM pg_roles WHERE rolname = $1', [role]);
      const oid = roleOid.rows[0]?.oid;
      if (!oid) throw new Error('Unable to resolve backup role');
      const outsideSchema = await client.query("SELECT 1 FROM pg_namespace n WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema') AND n.nspacl IS NOT NULL AND EXISTS (SELECT 1 FROM aclexplode(n.nspacl) a WHERE a.grantee = $1::oid AND a.privilege_type IN ('USAGE', 'CREATE')) LIMIT 1", [oid]);
      const ownedDatabase = await client.query('SELECT 1 FROM pg_database WHERE datdba = $1::oid LIMIT 1', [oid]);
      if (memberships.rowCount || owned.rowCount || outsidePublic.rowCount || outsideSchema.rowCount || ownedDatabase.rowCount || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || !row.rolbypassrls || row.rolinherit || !row.rolcanlogin) {
        throw new Error('Existing backup role is not a dedicated safe identity');
      }
    }
    await client.query(`DO $provision$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN
          EXECUTE 'CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS';
        END IF;
      END
    $provision$;`);
    await client.query(`ALTER ROLE ${roleIdentifier} WITH LOGIN CONNECTION LIMIT 4 PASSWORD ${literal(backupPassword)}`);
    const attributes = await client.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean; rolinherit: boolean; rolcanlogin: boolean }>(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin FROM pg_roles WHERE rolname = ${literal(role)}`);
    const row = attributes.rows[0];
    if (!row || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || !row.rolbypassrls || row.rolinherit || !row.rolcanlogin) throw new Error('Backup role has unsafe attributes');
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${roleIdentifier}`);
    await client.query(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier}`);
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${roleIdentifier}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${roleIdentifier}`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${roleIdentifier}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${roleIdentifier}`);
    await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdentifier}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public REVOKE ALL ON TABLES FROM ${roleIdentifier}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON TABLES TO ${roleIdentifier}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${roleIdentifier}`);
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${roleIdentifier}`);
    const effectiveWrite = await client.query<{ table_write: boolean; sequence_write: boolean; schema_create: boolean; database_create: boolean }>(`
      SELECT
        COALESCE((SELECT bool_or(
          has_table_privilege(${literal(role)}, c.oid, 'INSERT') OR
          has_table_privilege(${literal(role)}, c.oid, 'UPDATE') OR
          has_table_privilege(${literal(role)}, c.oid, 'DELETE') OR
          has_table_privilege(${literal(role)}, c.oid, 'TRUNCATE') OR
          has_table_privilege(${literal(role)}, c.oid, 'REFERENCES') OR
          has_table_privilege(${literal(role)}, c.oid, 'TRIGGER')
        ) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')), false) AS table_write,
        COALESCE((SELECT bool_or(
          has_sequence_privilege(${literal(role)}, c.oid, 'USAGE') OR
          has_sequence_privilege(${literal(role)}, c.oid, 'UPDATE')
        ) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'S'), false) AS sequence_write,
        has_schema_privilege(${literal(role)}, 'public', 'CREATE') AS schema_create,
        has_database_privilege(${literal(role)}, current_database(), 'CREATE') AS database_create
    `);
    const writeRow = effectiveWrite.rows[0];
    if (!writeRow || writeRow.table_write || writeRow.sequence_write || writeRow.schema_create || writeRow.database_create) {
      throw new Error('Backup role has effective write or create privileges');
    }
    await client.query('COMMIT');
    console.log(`Provisioned read-only backup role ${role}.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[database-url]').replace(/\s+/gu, ' ').slice(0, 500);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
