import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { finished, pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { Client } from 'pg';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const BACKUP_MAGIC = Buffer.from('IPDDBKP1', 'ascii');
export const BACKUP_VERSION = 1;
export const BACKUP_PART_SIZE = 8 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const TIMESTAMP_KEY = /^(\d{8}T\d{6}Z)-([a-f0-9]{16})\.backup$/;

export function assertPackageSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PACKAGE_BYTES) {
    throw new Error('Backup package exceeds the maximum supported size');
  }
}

export type TableCount = { table: string; rows: number };
export type BackupMetadata = {
  schema: 'public';
  snapshot: string;
  tables: readonly TableCount[];
};
export type BackupManifest = BackupMetadata & {
  capturedAt: string;
  archiveSha256: string;
  archiveCiphertextBytes: number;
};
export type BackupHeader = {
  version: 1;
  algorithm: 'aes-256-gcm';
  keyId: string;
  createdAt: string;
  manifestNonce: string;
  archiveNonce: string;
  manifestCiphertextBytes: number;
  archiveCiphertextBytes: number;
  archiveSha256: string;
};

export type BackupConfig = {
  databaseUrl: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  caCert?: string;
  key: Buffer;
  keyId: string;
  retentionDays: number;
};

export type S3Runtime = { client: S3Client; bucket: string; prefix: string };
type DumpSource = Readable & { completion: Promise<void>; cancel: () => void };

export function parseDatabaseUrl(value: string, variableName: string): { url: URL; local: boolean; connectionString: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${variableName} must be a valid PostgreSQL URL`); }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error(`${variableName} must be a PostgreSQL URL`);
  for (const name of ['host', 'hostaddr', 'port', 'user', 'dbname']) if (url.searchParams.has(name)) throw new Error(`${variableName} must not contain connection override parameters`);
  const clean = new URL(url.toString()); clean.search = ''; clean.hash = '';
  const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || isIP(host) === 4 && host.startsWith('127.');
  return { url, local, connectionString: clean.toString() };
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): Pick<BackupConfig, 'endpoint' | 'region' | 'bucket' | 'prefix' | 'forcePathStyle' | 'accessKeyId' | 'secretAccessKey'> {
  const endpoint = requiredFrom(env, 'BACKUP_S3_ENDPOINT');
  let endpointUrl: URL;
  try { endpointUrl = new URL(endpoint); } catch { throw new Error('BACKUP_S3_ENDPOINT must be an absolute URL'); }
  if (endpointUrl.protocol !== 'https:' && endpointUrl.hostname !== 'localhost' && endpointUrl.hostname !== '127.0.0.1') throw new Error('BACKUP_S3_ENDPOINT must use HTTPS');
  return {
    endpoint,
    region: env['BACKUP_S3_REGION'] ?? env['REGION'] ?? env['AWS_REGION'] ?? 'us-east-1',
    bucket: firstEnv(env, ['BACKUP_S3_BUCKET', 'BUCKET']),
    prefix: validatePrefix(firstEnv(env, ['BACKUP_S3_PREFIX', 'PREFIX'])),
    forcePathStyle: (env['BACKUP_S3_FORCE_PATH_STYLE'] ?? env['FORCE_PATH_STYLE'] ?? 'true').toLowerCase() === 'true',
    accessKeyId: firstEnv(env, ['BACKUP_S3_ACCESS_KEY_ID', 'ACCESS_KEY_ID']),
    secretAccessKey: firstEnv(env, ['BACKUP_S3_SECRET_ACCESS_KEY', 'SECRET_ACCESS_KEY']),
  };
}

export function validatePrefix(prefix: string): string {
  if (!prefix || prefix.startsWith('/') || !prefix.endsWith('/') || prefix.includes('..') || /[\u0000-\u001f]/u.test(prefix)) {
    throw new Error('BACKUP_S3_PREFIX must be a non-empty relative prefix ending with /');
  }
  return prefix;
}

export function parseEncryptionKey(value: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new Error('BACKUP_ENCRYPTION_KEY must be base64');
  }
  if (key.length !== 32 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
  const keyText = env['BACKUP_ENCRYPTION_KEY'];
  if (!keyText) throw new Error('BACKUP_ENCRYPTION_KEY is required');
  const retentionText = env['BACKUP_RETENTION_DAYS'] ?? '14';
  const retentionDays = Number(retentionText);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS must be an integer from 1 to 3650');
  }
  const storage = loadStorageConfig(env);
  const caCert = env['BACKUP_DATABASE_CA_CERT']?.trim() || undefined;
  if (caCert && (!caCert.includes('-----BEGIN CERTIFICATE-----') || !caCert.includes('-----END CERTIFICATE-----'))) throw new Error('BACKUP_DATABASE_CA_CERT must be PEM encoded');
  const databaseUrl = requiredFrom(env, 'BACKUP_DATABASE_URL');
  if (env['DIRECT_URL'] && databaseUrl === env['DIRECT_URL']) throw new Error('BACKUP_DATABASE_URL must not be DIRECT_URL');
  parseDatabaseUrl(databaseUrl, 'BACKUP_DATABASE_URL');
  validateSupabaseProject(databaseUrl, storage.prefix);
  return {
    databaseUrl,
    ...storage,
    caCert,
    key: parseEncryptionKey(keyText),
    keyId: createHash('sha256').update(parseEncryptionKey(keyText)).digest('hex').slice(0, 16),
    retentionDays,
  };
}

function validateSupabaseProject(databaseUrl: string, prefix: string): void {
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('BACKUP_DATABASE_URL must be a valid PostgreSQL URL'); }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('BACKUP_DATABASE_URL must be a PostgreSQL URL');
  const projectRef = prefix.split('/')[0];
  if (!/^[a-z0-9]{10,30}$/u.test(projectRef) || !/supabase\.(?:co|com)$/iu.test(url.hostname) && !/supabase\.(?:co|com)$/iu.test(url.hostname.split('.').slice(-2).join('.'))) return;
  const username = decodeURIComponent(url.username);
  if (!username.endsWith(`.${projectRef}`) && !url.hostname.includes(projectRef)) throw new Error('BACKUP_DATABASE_URL project does not match BACKUP_S3_PREFIX');
}

function requiredFrom(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function firstEnv(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const name of names) if (env[name]) return env[name] as string;
  throw new Error(`${names[0]} is required`);
}

export function createS3Runtime(config: Pick<BackupConfig, 'endpoint' | 'region' | 'bucket' | 'prefix' | 'forcePathStyle' | 'accessKeyId' | 'secretAccessKey'>): S3Runtime {
  return {
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 15_000, requestTimeout: 120_000, throwOnRequestTimeout: true },
    }),
    bucket: config.bucket,
    prefix: config.prefix,
  };
}

export function objectKey(prefix: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `${validatePrefix(prefix)}${stamp}-${randomBytes(8).toString('hex')}.backup`;
}

export function isOwnedBackupKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  return TIMESTAMP_KEY.test(key.slice(prefix.length));
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function countPublicTables(client: Client): Promise<TableCount[]> {
  const result = await client.query<{ table_name: string; row_count: string }>(`
    SELECT c.relname AS table_name, c.reltuples::bigint::text AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);
  // reltuples is only an estimate and cannot satisfy an exact backup manifest.
  const counts: TableCount[] = [];
  for (const table of result.rows) {
    const safe = table.table_name.replaceAll('"', '""');
    const exact = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM public."${safe}"`);
    counts.push({ table: table.table_name, rows: Number(exact.rows[0]?.count ?? '0') });
  }
  return counts;
}

export async function exportSnapshot(databaseUrl: string, caCert?: string): Promise<{ client: Client; snapshot: string; tables: TableCount[] }> {
  const database = parseDatabaseUrl(databaseUrl, 'BACKUP_DATABASE_URL');
  const client = new Client({ connectionString: database.connectionString, ssl: database.local ? false : { rejectUnauthorized: true, ...(caCert ? { ca: caCert } : {}) }, connectionTimeoutMillis: 15_000, statement_timeout: 120_000, query_timeout: 120_000 });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot')).rows[0]?.snapshot;
    if (!snapshot) throw new Error('Unable to export database snapshot');
    const tables = await countPublicTables(client);
    return { client, snapshot, tables };
  } catch (error: unknown) {
    await client.end().catch(() => undefined);
    throw error;
  }
}

export async function encryptPgDump(options: {
  databaseUrl: string;
  snapshot: string;
  metadata: BackupMetadata;
  key: Buffer;
  keyId: string;
  caCert?: string;
  outputPath: string;
  spawnDump?: (databaseUrl: string, snapshot: string) => Readable;
  signal?: AbortSignal;
}): Promise<{ archiveNonce: Buffer; archiveSha256: string; archiveCiphertextBytes: number }> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', options.key, nonce);
  const output = createWriteStream(options.outputPath, { mode: 0o600 });
  const caPath = options.caCert ? join(dirname(options.outputPath), '.pg-ca.crt') : undefined;
  if (caPath && options.caCert) await fs.writeFile(caPath, options.caCert, { mode: 0o600 });
  const source = options.spawnDump?.(options.databaseUrl, options.snapshot) ?? spawnPgDump(options.databaseUrl, options.snapshot, caPath);
  const abortDump = (): void => { if ('cancel' in source) (source as DumpSource).cancel(); };
  options.signal?.addEventListener('abort', abortDump, { once: true });
  const digest = createHash('sha256');
  let bytes = 0;
  const digestTransform = new (class extends Transform {
    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
      digest.update(chunk); bytes += chunk.length; callback(null, chunk);
    }
  })();
  const completion = 'completion' in source
    ? (source as DumpSource).completion.catch((error: unknown) => { source.destroy(error instanceof Error ? error : new Error(String(error))); throw error; })
    : undefined;
  let pipelinePromise: Promise<void> | undefined;
  try {
    cipher.setAAD(aadBytes(options.keyId));
    pipelinePromise = options.signal ? pipeline(source, cipher, digestTransform, output, { signal: options.signal }) : pipeline(source, cipher, digestTransform, output);
    if (completion) await Promise.all([pipelinePromise, completion]);
    else await pipelinePromise;
    const tag = cipher.getAuthTag();
    await fs.appendFile(options.outputPath, tag);
    digest.update(tag);
    bytes += tag.length;
    return { archiveNonce: nonce, archiveSha256: digest.digest('hex'), archiveCiphertextBytes: bytes };
  } catch (error: unknown) {
    if ('cancel' in source) (source as DumpSource).cancel();
    await pipelinePromise?.catch(() => undefined);
    await fs.rm(options.outputPath, { force: true }).catch(() => undefined);
    if (caPath) await fs.rm(caPath, { force: true }).catch(() => undefined);
    throw new Error(`pg_dump failed: ${sanitizeError(error)}`);
  } finally {
    if (caPath) await fs.rm(caPath, { force: true }).catch(() => undefined);
    options.signal?.removeEventListener('abort', abortDump);
  }
}

// Imported lazily in the function to keep unit tests independent of a local pg_dump binary.
function spawnPgDump(databaseUrl: string, snapshot: string, caPath?: string): DumpSource {
  const database = parseDatabaseUrl(databaseUrl, 'BACKUP_DATABASE_URL');
  const parsed = database.url;
  let resolveCompletion: () => void = () => undefined;
  let rejectCompletion: (error: Error) => void = () => undefined;
  const completion = new Promise<void>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  const child = spawn('pg_dump', [
    '--schema=public',
    '--format=custom',
    '--compress=6',
    '--no-owner',
    '--no-acl',
    `--snapshot=${snapshot}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || undefined,
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
      PGSSLMODE: database.local ? 'disable' : 'verify-full',
      ...(database.local ? {} : { PGSSLROOTCERT: caPath ?? 'system' }),
    },
  });
  const errors: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => { errors.push(chunk.subarray(0, 4096)); });
  const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, 15 * 60 * 1000);
  child.once('error', (error: Error) => { clearTimeout(timer); const safe = new Error(`pg_dump failed: ${sanitizeError(error)}`); child.stdout?.destroy(safe); rejectCompletion(safe); });
  child.once('close', (code: number | null) => {
    clearTimeout(timer);
    if (code === 0) resolveCompletion();
    else { const safe = new Error(`pg_dump exited with status ${code ?? 'unknown'}: ${sanitizeError(Buffer.concat(errors).toString('utf8'))}`); child.stdout?.destroy(safe); rejectCompletion(safe); }
  });
  if (!child.stdout) throw new Error('pg_dump did not provide stdout');
  const source = child.stdout as DumpSource;
  source.completion = completion;
  source.cancel = () => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); };
  return source;
}

function aadBytes(keyId: string): Buffer { return Buffer.from(JSON.stringify({ version: 1, algorithm: 'aes-256-gcm', keyId }), 'utf8'); }

export function sanitizeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[database-url]')
    .replace(/(?:password|secret|access[_-]?key|token)\s*[=:]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(/\s+/gu, ' ')
    .slice(0, 500);
}

export async function uploadFile(runtime: S3Runtime, key: string, path: string, contentLength?: number, signal?: AbortSignal): Promise<void> {
  const uploadController = new AbortController();
  const abort = (): void => uploadController.abort();
  if (signal?.aborted) uploadController.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const upload = new Upload({
    client: runtime.client,
    params: { Bucket: runtime.bucket, Key: key, Body: createReadStream(path), ContentType: 'application/octet-stream', ...(contentLength === undefined ? {} : { ContentLength: contentLength }) },
    partSize: BACKUP_PART_SIZE,
    leavePartsOnError: false,
    abortController: uploadController,
  });
  try { await upload.done(); } finally { signal?.removeEventListener('abort', abort); }
}

export async function remoteSha256(runtime: S3Runtime, key: string, signal?: AbortSignal): Promise<string> {
  const response = await runtime.client.send(new GetObjectCommand({ Bucket: runtime.bucket, Key: key }), signal ? { abortSignal: signal } : undefined);
  if (!response.Body) throw new Error('Remote backup returned no body');
  if (response.ContentLength !== undefined) assertPackageSize(response.ContentLength);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    if (signal?.aborted) throw new Error('Backup interrupted');
    bytes += chunk.length;
    assertPackageSize(bytes);
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function pruneBackups(runtime: S3Runtime, retentionDays: number, now = new Date(), signal?: AbortSignal): Promise<string[]> {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];
  let continuationToken: string | undefined;
  do {
    if (signal?.aborted) throw new Error('Backup interrupted');
    const page = await runtime.client.send(new ListObjectsV2Command({ Bucket: runtime.bucket, Prefix: runtime.prefix, ContinuationToken: continuationToken }), signal ? { abortSignal: signal } : undefined);
    const candidates = (page.Contents ?? []).flatMap((entry) => {
      const key = entry.Key;
      if (!key || !isOwnedBackupKey(key, runtime.prefix)) return [];
      const stamp = key.slice(runtime.prefix.length, -'.backup'.length).slice(0, 16);
      const parsed = parseTimestamp(stamp);
      return parsed !== undefined && parsed < cutoff && entry.LastModified instanceof Date && entry.LastModified.getTime() < cutoff ? [key] : [];
    });
    if (candidates.length > 0) {
      if (signal?.aborted) throw new Error('Backup interrupted');
      const result = await runtime.client.send(new DeleteObjectsCommand({ Bucket: runtime.bucket, Delete: { Objects: candidates.map((Key) => ({ Key })), Quiet: true } }), signal ? { abortSignal: signal } : undefined);
      if (result.Errors && result.Errors.length > 0) throw new Error('S3 backup pruning failed');
      deleted.push(...candidates);
    }
    if (page.IsTruncated && !page.NextContinuationToken) throw new Error('S3 backup listing was truncated without a continuation token');
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

function parseTimestamp(value: string): number | undefined {
  if (!/^\d{8}T\d{6}Z$/u.test(value)) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(value);
  if (!match) return undefined;
  const date = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
  return Number.isNaN(date) ? undefined : date;
}

export async function createPackage(options: {
  outputPath: string;
  archivePath: string;
  metadata: BackupMetadata;
  archive: { archiveNonce: Buffer; archiveSha256: string; archiveCiphertextBytes: number };
  key: Buffer;
  keyId: string;
  capturedAt: string;
}): Promise<{ packageSha256: string; bytes: number; manifest: BackupManifest }> {
  const manifest: BackupManifest = { ...options.metadata, capturedAt: options.capturedAt, archiveSha256: options.archive.archiveSha256, archiveCiphertextBytes: options.archive.archiveCiphertextBytes };
  const stableMetadata = aadBytes(options.keyId);
  const manifestNonce = randomBytes(12);
  const manifestCipher = createCipheriv('aes-256-gcm', options.key, manifestNonce);
  manifestCipher.setAAD(stableMetadata);
  const manifestCiphertext = Buffer.concat([manifestCipher.update(Buffer.from(JSON.stringify(manifest), 'utf8')), manifestCipher.final(), manifestCipher.getAuthTag()]);
  const header: BackupHeader = {
    version: 1,
    algorithm: 'aes-256-gcm',
    keyId: options.keyId,
    createdAt: options.capturedAt,
    manifestNonce: manifestNonce.toString('base64'),
    archiveNonce: options.archive.archiveNonce.toString('base64'),
    manifestCiphertextBytes: manifestCiphertext.length,
    archiveCiphertextBytes: options.archive.archiveCiphertextBytes,
    archiveSha256: options.archive.archiveSha256,
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const prelude = Buffer.alloc(BACKUP_MAGIC.length + 4);
  BACKUP_MAGIC.copy(prelude);
  prelude.writeUInt32BE(headerBytes.length, BACKUP_MAGIC.length);
  const output = createWriteStream(options.outputPath, { mode: 0o600 });
  const outputFinished = finished(output);
  const digest = createHash('sha256');
  let bytes = 0;
  const write = async (chunk: Buffer): Promise<void> => { if (!output.write(chunk)) await onceDrain(output); digest.update(chunk); bytes += chunk.length; };
  try {
    await write(prelude); await write(headerBytes); await write(manifestCiphertext);
    for await (const chunk of createReadStream(options.archivePath)) await write(chunk);
    output.end();
    await outputFinished;
    assertPackageSize(bytes);
  } catch (error: unknown) {
    output.destroy(); await outputFinished.catch(() => undefined); await fs.rm(options.outputPath, { force: true }).catch(() => undefined); throw error;
  }
  return { packageSha256: digest.digest('hex'), bytes, manifest };
}

function onceDrain(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { stream.removeListener('drain', onDrain); stream.removeListener('error', onError); };
    const onDrain = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    stream.once('drain', onDrain); stream.once('error', onError);
  });
}

export async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'ipd-backup-'));
}

export async function cleanupTempDir(path: string | undefined): Promise<void> {
  if (path) await fs.rm(path, { recursive: true, force: true }).catch(() => undefined);
}

export async function decryptPackage(path: string, key: Buffer, signal?: AbortSignal): Promise<{ header: BackupHeader; manifest: BackupManifest; archivePath: string }> {
  const stats = await fs.stat(path);
  if (!stats.isFile() || stats.size > MAX_PACKAGE_BYTES) throw new Error('Backup package exceeds the maximum supported size');
  const prelude = await readRange(path, 0, BACKUP_MAGIC.length + 4);
  if (!prelude.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new Error('Invalid backup framing');
  const headerLength = prelude.readUInt32BE(BACKUP_MAGIC.length);
  const offset = BACKUP_MAGIC.length + 4;
  if (headerLength < 2 || headerLength > 64 * 1024 || offset + headerLength > stats.size) throw new Error('Invalid backup header');
  const headerBytes = await readRange(path, offset, headerLength);
  let header: BackupHeader;
  try { header = JSON.parse(headerBytes.toString('utf8')) as BackupHeader; } catch { throw new Error('Invalid backup header'); }
  if (header.version !== 1 || header.algorithm !== 'aes-256-gcm' || typeof header.keyId !== 'string' || typeof header.createdAt !== 'string' || typeof header.manifestNonce !== 'string' || typeof header.archiveNonce !== 'string' || typeof header.archiveSha256 !== 'string') throw new Error('Unsupported backup version');
  if (!Number.isSafeInteger(header.manifestCiphertextBytes) || !Number.isSafeInteger(header.archiveCiphertextBytes) || header.manifestCiphertextBytes < 16 || header.archiveCiphertextBytes < 16 || header.manifestCiphertextBytes > MAX_MANIFEST_BYTES) throw new Error('Invalid backup lengths');
  const manifestNonce = Buffer.from(header.manifestNonce, 'base64');
  const archiveNonce = Buffer.from(header.archiveNonce, 'base64');
  if (manifestNonce.length !== 12 || archiveNonce.length !== 12 || !/^[a-f0-9]{64}$/u.test(header.archiveSha256)) throw new Error('Invalid backup authentication metadata');
  const manifestStart = offset + headerLength;
  const archiveStart = manifestStart + header.manifestCiphertextBytes;
  const archiveEnd = archiveStart + header.archiveCiphertextBytes;
  if (archiveEnd !== stats.size) throw new Error('Invalid backup lengths');
  const manifestInput = await readRange(path, manifestStart, header.manifestCiphertextBytes);
  const metadata = aadBytes(header.keyId);
  let manifest: BackupManifest;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, manifestNonce);
    decipher.setAAD(metadata);
    decipher.setAuthTag(manifestInput.subarray(-16));
    manifest = JSON.parse(Buffer.concat([decipher.update(manifestInput.subarray(0, -16)), decipher.final()]).toString('utf8')) as BackupManifest;
  } catch { throw new Error('Backup manifest authentication failed'); }
  if (manifest.schema !== 'public' || typeof manifest.capturedAt !== 'string' || !Array.isArray(manifest.tables) || manifest.tables.some((table) => typeof table.table !== 'string' || !Number.isSafeInteger(table.rows) || table.rows < 0)) throw new Error('Invalid backup manifest');
  if (header.createdAt !== manifest.capturedAt) throw new Error('Backup header/manifest timestamp mismatch');
  if (manifest.archiveSha256 !== header.archiveSha256 || manifest.archiveCiphertextBytes !== header.archiveCiphertextBytes) throw new Error('Backup manifest/header mismatch');
  const archivePath = `${path}.restore`;
  const digest = createHash('sha256');
  const digestTransform = new Transform({ transform(chunk: Buffer, _encoding, callback) { digest.update(chunk); callback(null, chunk); } });
  try {
    if (signal) await pipeline(createReadStream(path, { start: archiveStart, end: archiveEnd - 1 }), digestTransform, createWriteStream(archivePath, { mode: 0o600 }), { signal });
    else await pipeline(createReadStream(path, { start: archiveStart, end: archiveEnd - 1 }), digestTransform, createWriteStream(archivePath, { mode: 0o600 }));
  } catch (error: unknown) {
    await fs.rm(archivePath, { force: true }).catch(() => undefined);
    throw new Error(`Backup archive read failed: ${sanitizeError(error)}`);
  }
  if (digest.digest('hex') !== header.archiveSha256) { await fs.rm(archivePath, { force: true }); throw new Error('Backup archive checksum mismatch'); }
  return { header, manifest, archivePath };
}

export async function decryptArchiveToFile(options: { archivePath: string; outputPath: string; key: Buffer; header: BackupHeader; signal?: AbortSignal }): Promise<void> {
  const stats = await fs.stat(options.archivePath);
  if (stats.size < 16 || stats.size > MAX_PACKAGE_BYTES) throw new Error('Invalid encrypted archive');
  try {
    const tag = await readRange(options.archivePath, stats.size - 16, 16);
    const decipher = createDecipheriv('aes-256-gcm', options.key, Buffer.from(options.header.archiveNonce, 'base64'));
    decipher.setAAD(aadBytes(options.header.keyId));
    decipher.setAuthTag(tag);
    if (options.signal) await pipeline(createReadStream(options.archivePath, { start: 0, end: stats.size - 17 }), decipher, createWriteStream(options.outputPath, { mode: 0o600 }), { signal: options.signal });
    else await pipeline(createReadStream(options.archivePath, { start: 0, end: stats.size - 17 }), decipher, createWriteStream(options.outputPath, { mode: 0o600 }));
  } catch { await fs.rm(options.outputPath, { force: true }).catch(() => undefined); throw new Error('Backup archive authentication failed'); }
}

async function readRange(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r');
  const output = Buffer.alloc(length);
  try {
    let offset = 0;
    while (offset < length) {
      const result = await handle.read(output, offset, length - offset, start + offset);
      if (result.bytesRead === 0) throw new Error('Unexpected end of backup package');
      offset += result.bytesRead;
    }
    return output;
  } finally { await handle.close(); }
}
