import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { withLineConfigLock } from '../src/lib/line-config-lock';

const testDatabaseUrl = process.env['LINE_TEST_DATABASE_URL'];
const integration = testDatabaseUrl ? describe : describe.skip;

integration('LINE configuration lock PostgreSQL integration', () => {
  const prisma = testDatabaseUrl
    ? new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) })
    : null;

  beforeAll(async () => {
    if (prisma) await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('sets a bounded SQL lock_timeout inside the transaction', async () => {
    if (!prisma) return;
    await withLineConfigLock(prisma, async (transaction) => {
      const rows = await transaction.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`;
      expect(rows[0]?.lock_timeout).toBe('2s');
    });
  });

  it('exposes a commit deadline with remaining provider budget', async () => {
    if (!prisma) return;
    const before = Date.now();
    await withLineConfigLock(prisma, async (_transaction, context) => {
      expect(context.deadlineAt).toBeGreaterThanOrEqual(before + 14_000);
      expect(context.commitDeadlineAt).toBeLessThan(context.deadlineAt);
      expect(context.remainingMs()).toBeGreaterThan(0);
    });
  });
});
