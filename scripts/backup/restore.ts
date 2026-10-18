import { createWriteStream, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  cleanupTempDir,
  countPublicTables,
  createS3Runtime,
  decryptArchiveToFile,
  decryptPackage,
  assertPackageSize,
  isOwnedBackupKey,
  loadStorageConfig,
  makeTempDir,
  parseEncryptionKey,
  parseDatabaseUrl,
  sanitizeError,
} from './backup-common';

export function assertDistinctDatabaseUrls(sourceUrl: string, restoreUrl: string): void {
  if (!sourceUrl || !restoreUrl) throw new Error('Source and restore database URLs are required');
  try {
    const source = parseDatabaseUrl(sourceUrl, 'BACKUP_DATABASE_URL').url;
    const restore = parseDatabaseUrl(restoreUrl, 'RESTORE_DATABASE_URL').url;
    if (!['postgresql:', 'postgres:'].includes(source.protocol) || !['postgresql:', 'postgres:'].includes(restore.protocol)) throw new Error('Source and restore database URLs must be valid PostgreSQL URLs');
    const identity = (url: URL): string => {
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/^localhost$/u, '127.0.0.1');
      return `${host}:${url.port || '5432'}${decodeURIComponent(url.pathname)}`;
    };
    if (identity(source) === identity(restore)) {
      throw new Error('Source and restore database URLs must differ');
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Source and restore database URLs must differ') throw error;
    throw new Error('Source and restore database URLs must be valid PostgreSQL URLs');
  }
}

export function assertLocalRestoreUrl(value: string): void {
  let url: URL;
  try { url = parseDatabaseUrl(value, 'RESTORE_DATABASE_URL').url; } catch (error: unknown) { throw error; }
  if ([...url.searchParams.keys()].length > 0) throw new Error('RESTORE_DATABASE_URL must not contain connection override parameters');
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || isIP(host) === 4 && host.startsWith('127.');
  if (!local) throw new Error('RESTORE_DATABASE_URL must point to a local disposable database');
}

async function assertEmptyPublicDatabase(client: Client): Promise<void> {
  const objects = await client.query<{ object_count: string }>(`
    SELECT (
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') +
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') +
      (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public')
    )::text AS object_count
  `);
  if (objects.rows[0]?.object_count !== '0') throw new Error('Restore target public schema is not empty');
}

export async function ensureRestoreRole(client: Client): Promise<void> {
  const existing = await client.query<{ rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean }>({ text: 'SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1', values: ['ipd_app'] });
  const row = existing.rows[0];
  if (row && (row.rolcanlogin || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolbypassrls)) throw new Error('Restore target ipd_app role must be a minimally privileged NOLOGIN role');
  if (!row) {
    await client.query('CREATE ROLE "ipd_app" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  }
}

export async function downloadObject(runtime: ReturnType<typeof createS3Runtime>, key: string, path: string, signal?: AbortSignal): Promise<void> {
  const response = await runtime.client.send(new GetObjectCommand({ Bucket: runtime.bucket, Key: key }), signal ? { abortSignal: signal } : undefined);
  if (!response.Body) throw new Error('Backup object returned no body');
  if (response.ContentLength !== undefined) assertPackageSize(response.ContentLength);
  const output = createWriteStream(path, { mode: 0o600 });
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      bytes += chunk.length;
      try {
        assertPackageSize(bytes);
        callback(null, chunk);
      } catch (error: unknown) {
        callback(error instanceof Error ? error : new Error('Backup package exceeds the maximum supported size'));
      }
    },
  });
  try {
    if (signal) await pipeline(Readable.from(response.Body as AsyncIterable<Uint8Array>), limiter, output, { signal });
    else await pipeline(Readable.from(response.Body as AsyncIterable<Uint8Array>), limiter, output);
  } catch (error: unknown) {
    output.destroy();
    await fs.rm(path, { force: true }).catch(() => undefined);
    throw new Error(`Backup download failed: ${sanitizeError(error)}`);
  }
}

export function restoreDatabaseEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const parsed = parseDatabaseUrl(databaseUrl, 'RESTORE_DATABASE_URL').url;
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || undefined,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGSSLMODE: 'disable',
  };
}

export function localRestoreConnectionOptions(databaseUrl: string): { connectionString: string; ssl: false } {
  const parsed = parseDatabaseUrl(databaseUrl, 'RESTORE_DATABASE_URL');
  return { connectionString: parsed.connectionString, ssl: false };
}

async function restoreArchive(databaseUrl: string, archivePath: string, signal?: AbortSignal): Promise<void> {
  const database = parseDatabaseUrl(databaseUrl, 'RESTORE_DATABASE_URL');
  const databaseName = decodeURIComponent(database.url.pathname.slice(1));
  if (!databaseName) throw new Error('RESTORE_DATABASE_URL must include a database name');
  const child = spawn('pg_restore', ['--dbname', databaseName, '--schema=public', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', archivePath], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: restoreDatabaseEnvironment(databaseUrl),
  });
  const chunks: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk.subarray(0, 4096)));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  let interrupted = false;
  const terminate = (): void => {
    try { child.kill('SIGTERM'); } catch { /* child may already be closed */ }
    if (!forceKill) forceKill = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* child already exited */ } }, 5000);
    forceKill.unref();
  };
  const abort = (): void => { interrupted = true; terminate(); };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await Promise.race([
      once(child, 'close').then(([code]) => ({ code: code as number | null })),
      once(child, 'error').then(([error]) => { throw error; }),
      new Promise<{ code: number | null }>((_, reject) => {
        timeout = setTimeout(() => {
          terminate();
          once(child, 'close').then(() => { reject(new Error('pg_restore timed out')); });
        }, 15 * 60 * 1000);
      }),
    ]);
    const code = result.code;
    if (interrupted) throw new Error('Restore interrupted');
    if (code !== 0) throw new Error(`pg_restore failed: ${sanitizeError(Buffer.concat(chunks).toString('utf8'))}`);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
    signal?.removeEventListener('abort', abort);
  }
}

export async function runRestore(): Promise<{ key: string; manifest: unknown }> {
  const sourceUrl = process.env['BACKUP_DATABASE_URL'];
  const restoreUrl = process.env['RESTORE_DATABASE_URL'];
  if (!sourceUrl || !restoreUrl) throw new Error('BACKUP_DATABASE_URL and RESTORE_DATABASE_URL are required');
  assertDistinctDatabaseUrls(sourceUrl, restoreUrl);
  assertLocalRestoreUrl(restoreUrl);
  const key = process.env['BACKUP_OBJECT_KEY'];
  if (!key) throw new Error('BACKUP_OBJECT_KEY is required');
  const storage = loadStorageConfig();
  if (!isOwnedBackupKey(key, storage.prefix)) throw new Error('BACKUP_OBJECT_KEY is outside the configured backup prefix');
  const runtime = createS3Runtime(storage);
  const abortController = new AbortController();
  let target: Client | undefined;
  const stop = (): void => {
    abortController.abort();
    void target?.end().catch(() => undefined);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let temp: string | undefined;
  try {
    temp = await makeTempDir();
    if (abortController.signal.aborted) throw new Error('Restore interrupted');
    const packagePath = `${temp}/backup.package`;
    await downloadObject(runtime, key, packagePath, abortController.signal);
    const keyText = process.env['BACKUP_ENCRYPTION_KEY'];
    if (!keyText) throw new Error('BACKUP_ENCRYPTION_KEY is required');
    const encryptionKey = parseEncryptionKey(keyText);
    const decrypted = await decryptPackage(packagePath, encryptionKey, abortController.signal);
    const archivePath = `${temp}/archive.dump`;
    await decryptArchiveToFile({ archivePath: decrypted.archivePath, outputPath: archivePath, key: encryptionKey, header: decrypted.header, signal: abortController.signal });
    target = new Client({ ...localRestoreConnectionOptions(restoreUrl), connectionTimeoutMillis: 15_000, statement_timeout: 120_000, query_timeout: 120_000 });
    await target.connect();
    await target.query('BEGIN');
    await assertEmptyPublicDatabase(target);
    await ensureRestoreRole(target);
    await target.query('COMMIT');
    await target.end(); target = undefined;
    await restoreArchive(restoreUrl, archivePath, abortController.signal);
    target = new Client({ ...localRestoreConnectionOptions(restoreUrl), connectionTimeoutMillis: 15_000, statement_timeout: 120_000, query_timeout: 120_000 });
    await target.connect();
    const restoredTables = await countPublicTables(target);
    await target.end(); target = undefined;
    if (JSON.stringify(restoredTables) !== JSON.stringify(decrypted.manifest.tables)) throw new Error('Restored table counts do not match backup manifest');
    return { key, manifest: decrypted.manifest };
  } catch (error: unknown) {
    if (target) await target.query('ROLLBACK').catch(() => undefined);
    if (target) await target.end().catch(() => undefined);
    throw new Error(sanitizeError(error));
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await cleanupTempDir(temp);
  }
}

if (import.meta.main) {
  runRestore().then((result) => console.log(`Database backup restored: ${result.key}`)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database restore failed');
    process.exitCode = 1;
  });
}
