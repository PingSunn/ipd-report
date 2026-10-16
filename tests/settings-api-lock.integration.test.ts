import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  LINE_CONFIG_LOCK_TIMEOUT_MS,
  withLineConfigLock,
} from '../src/lib/line-config-lock';

const databaseUrl = process.env['LINE_TEST_DATABASE_URL'];
const integration = databaseUrl ? describe : describe.skip;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

integration('LINE configuration advisory lock', () => {
  const prisma = databaseUrl
    ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
    : null;

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('uses transaction local lock timeout and rejects a contending transaction', async () => {
    if (!prisma) return;

    const acquired = deferred<void>();
    const release = deferred<void>();
    const first = withLineConfigLock(prisma, async (transaction) => {
      const timeoutRows = await transaction.$queryRaw<Array<{ lock_timeout: string }>>`
        SHOW lock_timeout
      `;
      expect(timeoutRows[0]?.lock_timeout).toBe(`${LINE_CONFIG_LOCK_TIMEOUT_MS / 1000}s`);
      acquired.resolve();
      await release.promise;
      return true;
    });

    await acquired.promise;
    const startedAt = Date.now();
    await expect(withLineConfigLock(prisma, async () => true)).rejects.toThrow();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(LINE_CONFIG_LOCK_TIMEOUT_MS - 500);

    release.resolve();
    await expect(first).resolves.toBe(true);
  });
});
