import {
  type BackupManifest,
  assertPackageSize,
  cleanupTempDir,
  createPackage,
  createS3Runtime,
  encryptPgDump,
  exportSnapshot,
  hashFile,
  loadBackupConfig,
  makeTempDir,
  objectKey,
  pruneBackups,
  remoteSha256,
  uploadFile,
  sanitizeError,
} from './backup-common';

export async function runBackup(): Promise<{ key: string; manifest: BackupManifest; packageSha256: string }> {
  const config = loadBackupConfig();
  const temp = await makeTempDir();
  let client: Awaited<ReturnType<typeof exportSnapshot>>['client'] | undefined;
  let stopping = false;
  const abortController = new AbortController();
  const stop = (): void => { stopping = true; abortController.abort(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const snapshot = await exportSnapshot(config.databaseUrl, config.caCert);
    client = snapshot.client;
    const capturedAt = new Date().toISOString();
    const metadata = { schema: 'public' as const, snapshot: snapshot.snapshot, tables: snapshot.tables };
    const archivePath = `${temp}/archive.bin`;
    const archive = await encryptPgDump({ databaseUrl: config.databaseUrl, snapshot: snapshot.snapshot, metadata, key: config.key, keyId: config.keyId, caCert: config.caCert, outputPath: archivePath, signal: abortController.signal });
    await client.query('COMMIT');
    await client.end(); client = undefined;
    const packagePath = `${temp}/backup.package`;
    const packaged = await createPackage({ outputPath: packagePath, archivePath, metadata, archive, key: config.key, keyId: config.keyId, capturedAt });
    assertPackageSize(packaged.bytes);
    const localSha256 = await hashFile(packagePath);
    if (localSha256 !== packaged.packageSha256) throw new Error('Local backup checksum changed before upload');
    if (stopping) throw new Error('Backup interrupted');
    const runtime = createS3Runtime(config);
    const key = objectKey(config.prefix, new Date(capturedAt));
    await uploadFile(runtime, key, packagePath, packaged.bytes, abortController.signal);
    const remoteChecksum = await remoteSha256(runtime, key, abortController.signal);
    if (remoteChecksum !== localSha256) throw new Error('Remote backup checksum verification failed');
    if (stopping) throw new Error('Backup interrupted');
    await pruneBackups(runtime, config.retentionDays, new Date(), abortController.signal);
    return { key, manifest: packaged.manifest, packageSha256: localSha256 };
  } catch (error: unknown) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    if (client) await client.end().catch(() => undefined);
    throw new Error(sanitizeError(error));
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await cleanupTempDir(temp);
  }
}

if (import.meta.main) {
  runBackup().then((result) => {
    console.log(`Database backup uploaded: ${result.key}`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database backup failed');
    process.exitCode = 1;
  });
}
