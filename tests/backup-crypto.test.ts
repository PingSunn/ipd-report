import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  assertPackageSize,
  createS3Runtime,
  createPackage,
  decryptArchiveToFile,
  decryptPackage,
  encryptPgDump,
  loadBackupConfig,
  makeTempDir,
  MAX_PACKAGE_BYTES,
  parseEncryptionKey,
  pruneBackups,
  objectKey,
  type BackupMetadata,
} from '../scripts/backup/backup-common';
import { assertDistinctDatabaseUrls, assertLocalRestoreUrl, downloadObject, localRestoreConnectionOptions, restoreDatabaseEnvironment } from '../scripts/backup/restore';

const key = Buffer.alloc(32, 7);
const keyText = key.toString('base64');
const metadata: BackupMetadata = { schema: 'public', snapshot: '00000003-1', tables: [{ table: 'User', rows: 2 }] };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

async function packageFixture(): Promise<{ dir: string; packagePath: string }> {
  const dir = await makeTempDir(); tempDirs.push(dir);
  const encryptedArchive = `${dir}/archive.bin`;
  const archive = await encryptPgDump({
    databaseUrl: 'postgresql://backup@source/db', snapshot: metadata.snapshot, metadata, key, keyId: 'test-key', outputPath: encryptedArchive,
    spawnDump: () => Readable.from([Buffer.from('custom archive bytes')]),
  });
  const packagePath = `${dir}/backup.package`;
  await createPackage({ outputPath: packagePath, archivePath: encryptedArchive, metadata, archive, key, keyId: 'test-key', capturedAt: '2026-10-18T03:00:00.000Z' });
  return { dir, packagePath };
}

describe('encrypted backup framing', () => {
  it('round-trips the archive and manifest', async () => {
    const fixture = await packageFixture();
    const decrypted = await decryptPackage(fixture.packagePath, key);
    expect(decrypted.manifest.tables).toEqual(metadata.tables);
    const output = `${fixture.dir}/archive.dump`;
    await decryptArchiveToFile({ archivePath: decrypted.archivePath, outputPath: output, key, header: decrypted.header });
    await expect(fs.readFile(output, 'utf8')).resolves.toBe('custom archive bytes');
  });

  it('rejects tampering and a wrong key', async () => {
    const fixture = await packageFixture();
    const bytes = await fs.readFile(fixture.packagePath);
    bytes[bytes.length - 20] ^= 1;
    await fs.writeFile(fixture.packagePath, bytes);
    await expect(decryptPackage(fixture.packagePath, key)).rejects.toThrow(/checksum|authentication/u);
    const clean = await packageFixture();
    await expect(decryptPackage(clean.packagePath, Buffer.alloc(32, 8))).rejects.toThrow(/authentication/u);
  });

  it('cleans encrypted archive output after dump failure', async () => {
    const dir = await makeTempDir(); tempDirs.push(dir);
    const output = `${dir}/failed.archive`;
    const failing = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('synthetic dump failure'); })());
    await expect(encryptPgDump({ databaseUrl: 'postgresql://backup@source/db', snapshot: metadata.snapshot, metadata, key, keyId: 'test-key', outputPath: output, spawnDump: () => failing })).rejects.toThrow(/synthetic/u);
    await expect(fs.access(output)).rejects.toThrow();
  });

  it('fails when the dump process exits after producing stdout', async () => {
    const dir = await makeTempDir(); tempDirs.push(dir);
    const output = `${dir}/late-failure.archive`;
    const source = Readable.from([Buffer.from('partial')]) as Readable & { completion: Promise<void>; cancel: () => void };
    source.completion = Promise.reject(new Error('dump exited 1 after stdout'));
    source.cancel = () => undefined;
    await expect(encryptPgDump({ databaseUrl: 'postgresql://backup@source/db', snapshot: metadata.snapshot, metadata, key, keyId: 'test-key', outputPath: output, spawnDump: () => source })).rejects.toThrow(/exited 1/u);
    await expect(fs.access(output)).rejects.toThrow();
  });
});

describe('backup environment and restore guards', () => {
  it('rejects oversized packages at the upload gate while accepting the exact limit', () => {
    expect(() => assertPackageSize(MAX_PACKAGE_BYTES)).not.toThrow();
    expect(() => assertPackageSize(MAX_PACKAGE_BYTES + 1)).toThrow(/maximum supported size/u);
    expect(() => assertPackageSize(Number.POSITIVE_INFINITY)).toThrow(/maximum supported size/u);
  });

  it('rejects oversized remote objects before creating a restore file', async () => {
    const dir = await makeTempDir(); tempDirs.push(dir);
    const output = `${dir}/oversized.package`;
    const client = { send: vi.fn(async () => ({ ContentLength: MAX_PACKAGE_BYTES + 1, Body: Readable.from([]) })) };
    const runtime = { client, bucket: 'bucket', prefix: 'prefix/' } as unknown as ReturnType<typeof createS3Runtime>;
    await expect(downloadObject(runtime, 'prefix/object.backup', output)).rejects.toThrow(/maximum supported size/u);
    await expect(fs.access(output)).rejects.toThrow();
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid prefix and key values', () => {
    expect(() => loadBackupConfig({ BACKUP_ENCRYPTION_KEY: keyText, BACKUP_DATABASE_URL: 'x', BACKUP_S3_ENDPOINT: 'https://s3.test', BACKUP_S3_BUCKET: 'bucket', BACKUP_S3_PREFIX: '../', BACKUP_S3_ACCESS_KEY_ID: 'a', BACKUP_S3_SECRET_ACCESS_KEY: 'b' })).toThrow(/prefix/u);
    expect(() => parseEncryptionKey(Buffer.alloc(31).toString('base64'))).toThrow(/32-byte/u);
  });

  it('accepts an optional PEM CA certificate without exposing it in metadata', () => {
    const config = loadBackupConfig({
      BACKUP_ENCRYPTION_KEY: keyText,
      BACKUP_DATABASE_URL: 'postgresql://backup@source/db',
      BACKUP_S3_ENDPOINT: 'https://s3.test',
      BACKUP_S3_BUCKET: 'bucket',
      BACKUP_S3_PREFIX: 'prefix/',
      BACKUP_S3_ACCESS_KEY_ID: 'a',
      BACKUP_S3_SECRET_ACCESS_KEY: 'b',
      BACKUP_DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\npublic-test-ca\n-----END CERTIFICATE-----',
    });
    expect(config.caCert).toContain('BEGIN CERTIFICATE');
  });

  it('requires distinct databases and local restore targets', () => {
    expect(() => assertDistinctDatabaseUrls('postgresql://a@db/source', 'postgresql://b@db/source')).toThrow(/differ/u);
    expect(() => assertLocalRestoreUrl('postgresql://db.example/source')).toThrow(/local/u);
    expect(() => assertLocalRestoreUrl('postgresql://127.evil.com/source')).toThrow(/local/u);
    expect(() => assertLocalRestoreUrl('postgresql://127.0.0.1:45432/restore')).not.toThrow();
    expect(() => assertLocalRestoreUrl('postgresql://127.0.0.1:45432/restore?host=evil.example')).toThrow(/override/u);
    expect(objectKey('prefix/')).toMatch(/^prefix\/\d{8}T\d{6}Z-[a-f0-9]{16}\.backup$/u);
  });

  it('builds pg_restore environment without inheriting backup secrets', () => {
    const env = restoreDatabaseEnvironment('postgresql://restore:pw@127.0.0.1:45432/restore');
    expect(env).toMatchObject({ PGHOST: '127.0.0.1', PGPORT: '45432', PGUSER: 'restore', PGPASSWORD: 'pw', PGDATABASE: 'restore', PGSSLMODE: 'disable' });
    expect(env).not.toHaveProperty('BACKUP_DATABASE_URL');
    expect(env).not.toHaveProperty('BACKUP_ENCRYPTION_KEY');
    expect(env).not.toHaveProperty('BACKUP_S3_SECRET_ACCESS_KEY');
  });

  it('forces local pg clients to disable TLS and strips URL query overrides', () => {
    expect(localRestoreConnectionOptions('postgresql://restore:pw@127.0.0.1:45432/restore?sslmode=verify-full')).toEqual({
      connectionString: 'postgresql://restore:pw@127.0.0.1:45432/restore',
      ssl: false,
    });
  });
});

describe('safe retention pruning', () => {
  it('paginates and only deletes owned old timestamp keys', async () => {
    const sends: unknown[] = [];
    const client = { send: vi.fn(async (command: unknown) => {
      sends.push(command);
      if (sends.length === 1) return { Contents: [{ Key: 'prefix/20200101T000000Z-0123456789abcdef.backup', LastModified: new Date('2020-01-01T00:00:00Z') }, { Key: 'prefix/manual.backup' }], IsTruncated: true, NextContinuationToken: 'next' };
      if (sends.length === 2) return { Errors: [] };
      if (sends.length === 3) return { Contents: [{ Key: 'prefix/20200102T000000Z-abcdef0123456789.backup', LastModified: new Date('2020-01-02T00:00:00Z') }], IsTruncated: false };
      return { Errors: [] };
    }) } as unknown as S3Client;
    const deleted = await pruneBackups({ client, bucket: 'b', prefix: 'prefix/' }, 14, new Date('2026-10-18T00:00:00Z'));
    expect(deleted).toEqual(['prefix/20200101T000000Z-0123456789abcdef.backup', 'prefix/20200102T000000Z-abcdef0123456789.backup']);
    expect(sends).toHaveLength(4);
  });

  it('fails closed when deletion reports an error', async () => {
    let sendsLikeList = 0;
    const client = { send: vi.fn(async (_command: unknown) => {
      if (sendsLikeList++ % 2 === 0) return { Contents: [{ Key: 'prefix/20200101T000000Z-0123456789abcdef.backup', LastModified: new Date('2020-01-01T00:00:00Z') }], IsTruncated: false };
      return { Errors: [{ Key: 'prefix/20200101T000000Z-0123456789abcdef.backup' }] };
    }) } as unknown as S3Client;
    await expect(pruneBackups({ client, bucket: 'b', prefix: 'prefix/' }, 14, new Date('2026-10-18T00:00:00Z'))).rejects.toThrow(/pruning/u);
  });

  it('refuses a truncated listing without deleting anything', async () => {
    const client = { send: vi.fn(async () => ({ Contents: [], IsTruncated: true })) } as unknown as S3Client;
    await expect(pruneBackups({ client, bucket: 'b', prefix: 'prefix/' }, 14, new Date('2026-10-18T00:00:00Z'))).rejects.toThrow(/continuation/u);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('stops before deletion when cancelled', async () => {
    const controller = new AbortController(); controller.abort();
    const client = { send: vi.fn(async () => ({ Contents: [{ Key: 'prefix/20200101T000000Z-0123456789abcdef.backup', LastModified: new Date('2020-01-01T00:00:00Z') }], IsTruncated: false })) } as unknown as S3Client;
    await expect(pruneBackups({ client, bucket: 'b', prefix: 'prefix/' }, 14, new Date('2026-10-18T00:00:00Z'), controller.signal)).rejects.toThrow(/interrupted/u);
    expect(client.send).not.toHaveBeenCalled();
  });
});
