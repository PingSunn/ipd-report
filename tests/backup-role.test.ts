import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertDedicatedRoleName, provisionDatabaseConnectionOptions } from '../scripts/db/provision-backup-role';

describe('backup role provisioning guardrails', () => {
  it('rejects owner, runtime, and reserved PostgreSQL roles', () => {
    for (const role of ['postgres', 'ipd_app', 'pg_signal_backend', 'supabase_admin', 'rdsadmin']) {
      expect(() => assertDedicatedRoleName(role)).toThrow(/dedicated/u);
    }
  });

  it('accepts a dedicated lowercase role name', () => {
    expect(() => assertDedicatedRoleName('ipd_backup')).not.toThrow();
  });

  it('requires verified TLS for non-local owner connections and strips URL query overrides', () => {
    expect(provisionDatabaseConnectionOptions('postgresql://owner:pw@db.example/project?sslmode=disable', {})).toEqual({
      connectionString: 'postgresql://owner:pw@db.example/project',
      ssl: { rejectUnauthorized: true },
    });
    expect(provisionDatabaseConnectionOptions('postgresql://owner:pw@db.example/project', {
      BACKUP_DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
    })).toEqual({
      connectionString: 'postgresql://owner:pw@db.example/project',
      ssl: { rejectUnauthorized: true, ca: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----' },
    });
    expect(provisionDatabaseConnectionOptions('postgresql://owner:pw@127.0.0.1/project?sslmode=verify-full', {})).toEqual({
      connectionString: 'postgresql://owner:pw@127.0.0.1/project',
      ssl: false,
    });
  });

  it('does not attempt privileged ALTER ROLE clauses', () => {
    const source = readFileSync(new URL('../scripts/db/provision-backup-role.ts', import.meta.url), 'utf8');
    const alter = source.match(/ALTER ROLE \$\{roleIdentifier\} WITH[\s\S]*?`\);/u)?.[0] ?? '';
    expect(alter).toContain('LOGIN CONNECTION LIMIT 4 PASSWORD');
    expect(alter).not.toMatch(/NO\s*SUPERUSER|NOCREATEDB|NOCREATEROLE|NOINHERIT|NOREPLICATION|BYPASSRLS/u);
  });
});
