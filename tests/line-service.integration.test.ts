import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client';
import { withLineConfigLock } from '../src/lib/line-config-lock';
import { LineService } from '../src/lib/line/service';
import type { LineSettingsSnapshot, LineTransportRequest } from '../src/lib/line/types';

const testDatabaseUrl = process.env['LINE_TEST_DATABASE_URL'];
const integration = testDatabaseUrl ? describe : describe.skip;
const settings: LineSettingsSnapshot = {
  hospitalName: 'LINE integration hospital',
  wardName: 'LINE integration ward',
  reportFormat: 'standard',
  includeCapacityAndOccupancy: true,
  includeCategories: true,
  includeWorkloadHours: false,
  includeNote: true,
  lineEnabled: true,
  lineGroupId: '',
  nightSendTime: '08:00',
  morningSendTime: '16:00',
  afternoonSendTime: '00:00',
};

integration('LineService PostgreSQL integration', () => {
  const prisma = testDatabaseUrl
    ? new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) })
    : null;
  const fixtureIds: string[] = [];
  const fixtureGroups: string[] = [];

  beforeAll(async () => {
    if (!prisma) return;
    // Isolate this suite from an interrupted prior run; these prefixes are owned by this test file.
    await prisma.lineDelivery.deleteMany({ where: { groupId: { startsWith: 'line-it-' } } });
    await prisma.censusRecord.deleteMany({ where: { id: { startsWith: 'line-it-' } } });
    await prisma.verifiedLineGroup.deleteMany({ where: { groupId: { startsWith: 'line-it-' } } });
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const id of fixtureIds) await prisma.censusRecord.deleteMany({ where: { id } });
    for (const groupId of fixtureGroups) await prisma.lineDelivery.deleteMany({ where: { groupId } });
    for (const groupId of fixtureGroups) await prisma.verifiedLineGroup.deleteMany({ where: { groupId } });
    await prisma.$disconnect();
  });

  function transportFor(calls: LineTransportRequest[], result: 'accepted' | 'retryable' = 'accepted') {
    return {
      push: async (request: LineTransportRequest) => {
        calls.push(request);
        return result === 'accepted'
          ? { accepted: true as const }
          : { accepted: false as const, retryable: true, reason: 'test network failure' };
      },
    };
  }

  function service(
    now: Date,
    groupId: string,
    calls: LineTransportRequest[],
    transportResult: 'accepted' | 'retryable' = 'accepted',
    workerId = `line-it-${crypto.randomUUID()}`,
  ): LineService {
    if (!prisma) throw new Error('LINE_TEST_DATABASE_URL is required');
    fixtureGroups.push(groupId);
    return new LineService({
      prisma,
      now: () => now,
      workerId,
      transport: transportFor(calls, transportResult),
      tokenConfigured: () => true,
      settingsGetter: async () => ({ ...settings, lineGroupId: groupId }),
    });
  }

  async function verifyGroup(groupId: string): Promise<void> {
    if (!prisma) throw new Error('LINE_TEST_DATABASE_URL is required');
    const seenAt = new Date('2090-01-01T00:00:00.000Z');
    await prisma.verifiedLineGroup.upsert({
      where: { groupId },
      create: { groupId, firstSeen: seenAt, lastSeen: seenAt },
      update: { lastSeen: seenAt },
    });
  }

  async function createDelivery(input: {
    reportDate: string;
    shift: string;
    scheduledAt: Date;
    groupId: string;
    status?: string;
    claimedAt?: Date | null;
    leaseOwner?: string | null;
    nextAttemptAt?: Date | null;
  }) {
    if (!prisma) throw new Error('LINE_TEST_DATABASE_URL is required');
    fixtureGroups.push(input.groupId);
    return prisma.lineDelivery.create({
      data: {
        reportDate: new Date(`${input.reportDate}T00:00:00.000Z`),
        shift: input.shift,
        scheduledAt: input.scheduledAt,
        kind: 'MISSING',
        status: input.status ?? 'PENDING',
        messageText: `integration ${input.reportDate} ${input.shift}`,
        groupId: input.groupId,
        retryKey: crypto.randomUUID(),
        claimedAt: input.claimedAt ?? null,
        leaseOwner: input.leaseOwner ?? null,
        nextAttemptAt: input.nextAttemptAt ?? null,
        firstAttemptAt: input.status === 'PROCESSING' ? input.claimedAt ?? null : null,
      },
    });
  }

  async function createCensus(date: string, shift: string, id: string) {
    if (!prisma) throw new Error('LINE_TEST_DATABASE_URL is required');
    fixtureIds.push(id);
    return prisma.censusRecord.create({
      data: {
        id,
        date: new Date(`${date}T00:00:00.000Z`),
        shift,
        totalPatients: 12,
        capacity: 30,
        availableBeds: 18,
        newPatients: 2,
        discharges: 1,
        referrals: 0,
        cat1: 4,
        cat2: 3,
        cat3: 3,
        cat4: 1,
        cat5: 1,
        note: 'captured-at-materialization',
      },
    });
  }

  it('atomically claims one concurrent row and recovers an expired lease', async () => {
    if (!prisma) return;
    const concurrentNow = new Date('2090-01-06T01:00:00.000Z');
    const groupId = `line-it-claim-${crypto.randomUUID()}`;
    await verifyGroup(groupId);
    const concurrent = await createDelivery({
      reportDate: '2090-01-06',
      shift: 'ดึก',
      scheduledAt: concurrentNow,
      groupId,
    });
    const firstCalls: LineTransportRequest[] = [];
    const secondCalls: LineTransportRequest[] = [];
    await Promise.all([
      service(concurrentNow, groupId, firstCalls, 'accepted', 'line-it-concurrent-a').tick(),
      service(concurrentNow, groupId, secondCalls, 'accepted', 'line-it-concurrent-b').tick(),
    ]);
    const concurrentlyClaimed = await prisma.lineDelivery.findUnique({ where: { id: concurrent.id } });
    expect(firstCalls.length + secondCalls.length).toBe(1);
    expect(concurrentlyClaimed?.status).toBe('ACCEPTED');

    const now = new Date('2090-01-07T01:00:00.000Z');
    const stale = await createDelivery({
      reportDate: '2090-01-07',
      shift: 'ดึก',
      scheduledAt: now,
      groupId,
      status: 'PROCESSING',
      claimedAt: new Date(now.getTime() - 10 * 60_000),
      leaseOwner: 'crashed-worker',
    });
    const calls: LineTransportRequest[] = [];
    const result = await service(now, groupId, calls).tick();
    const recovered = await prisma.lineDelivery.findUnique({ where: { id: stale.id } });
    expect(result.status).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(recovered?.status).toBe('ACCEPTED');
    expect(recovered?.leaseOwner).toBeNull();
    expect(recovered?.retryKey).toBe(stale.retryKey);
  });

  it('snapshots a missing notice and does not resend after late census data arrives', async () => {
    if (!prisma) return;
    const now = new Date('2090-01-03T01:00:00.000Z');
    const groupId = `line-it-late-${crypto.randomUUID()}`;
    await verifyGroup(groupId);
    const calls: LineTransportRequest[] = [];
    const first = await service(now, groupId, calls).tick();
    expect(first.status).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.messages[0]?.text).toBe('3 ม.ค. 2633 · เวรดึก\nยังไม่มีข้อมูลเวรนี้');

    await createCensus('2090-01-03', 'ดึก', `line-it-census-${crypto.randomUUID()}`);
    const second = await service(new Date(now.getTime() + 60_000), groupId, calls).tick();
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(calls).toHaveLength(1);
  });

  it('rechecks configuration under the advisory lock before dispatch', async () => {
    if (!prisma) return;
    const now = new Date('2090-01-08T01:00:00.000Z');
    const groupId = `line-it-revoke-${crypto.randomUUID()}`;
    fixtureGroups.push(groupId);
    await verifyGroup(groupId);
    const calls: LineTransportRequest[] = [];
    let reads = 0;
    const serviceWithRevocation = new LineService({
      prisma,
      now: () => now,
      workerId: `line-it-revoke-worker-${crypto.randomUUID()}`,
      transport: transportFor(calls),
      tokenConfigured: () => true,
      settingsGetter: async () => ({ ...settings, lineGroupId: groupId, lineEnabled: reads++ === 0 }),
    });
    const result = await serviceWithRevocation.tick();
    const row = result.deliveryId
      ? await prisma.lineDelivery.findUnique({ where: { id: result.deliveryId } })
      : null;
    expect(result.action).toBe('DISABLED');
    expect(row?.status).toBe('PENDING');
    expect(calls).toHaveLength(0);
  });

  it('does not dispatch an old group after a settings transaction commits during lock contention', async () => {
    if (!prisma) return;
    const now = new Date('2090-01-09T01:00:00.000Z');
    const groupId = `line-it-lock-${crypto.randomUUID()}`;
    const markerId = `line-it-${crypto.randomUUID().slice(0, 8)}`;
    fixtureGroups.push(groupId);
    await verifyGroup(groupId);
    const calls: LineTransportRequest[] = [];
    const committedAt = new Date('2090-01-09T02:00:00.000Z');
    const worker = new LineService({
      prisma,
      now: () => now,
      workerId: `line-it-lock-worker-${crypto.randomUUID()}`,
      transport: transportFor(calls),
      tokenConfigured: () => true,
      settingsGetter: async () => {
        const marker = await prisma.lineWorkerState.findUnique({ where: { id: markerId } });
        return {
          ...settings,
          lineEnabled: marker?.lastSeenAt?.getTime() !== committedAt.getTime(),
          lineGroupId: marker?.lastSeenAt?.getTime() === committedAt.getTime() ? '' : groupId,
        };
      },
    });
    try {
      let tickPromise: Promise<Awaited<ReturnType<LineService['tick']>>> | null = null;
      await withLineConfigLock(prisma, async (transaction) => {
        tickPromise = worker.tick();
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        await transaction.lineWorkerState.upsert({
          where: { id: markerId },
          create: { id: markerId, lastSeenAt: committedAt },
          update: { lastSeenAt: committedAt },
        });
      });
      if (!tickPromise) throw new Error('worker tick did not start');
      await tickPromise;
      const row = await prisma.lineDelivery.findFirst({ where: { groupId } });
      expect(row?.status).toBe('PENDING');
      expect(calls).toHaveLength(0);
    } finally {
      await prisma.lineWorkerState.deleteMany({ where: { id: markerId } });
    }
  });

  it('materializes only the latest due slot and skips older pending slots', async () => {
    if (!prisma) return;
    const now = new Date('2090-01-14T17:01:00.000Z');
    const groupId = `line-it-latest-${crypto.randomUUID()}`;
    await verifyGroup(groupId);
    const oldOne = await createDelivery({
      reportDate: '2090-01-13',
      shift: 'ดึก',
      scheduledAt: new Date('2090-01-13T01:00:00.000Z'),
      groupId,
      status: 'PROCESSING',
      claimedAt: new Date(now.getTime() - 10 * 60_000),
      leaseOwner: 'expired-line-worker',
    });
    const oldTwo = await createDelivery({
      reportDate: '2090-01-13',
      shift: 'เช้า',
      scheduledAt: new Date('2090-01-13T09:00:00.000Z'),
      groupId,
      status: 'FAILED',
      nextAttemptAt: new Date(now.getTime() - 60_000),
    });
    const calls: LineTransportRequest[] = [];
    const result = await service(now, groupId, calls).tick();
    const rows = await prisma.lineDelivery.findMany({ where: { groupId } });
    const oldRows = rows.filter((row) => row.id === oldOne.id || row.id === oldTwo.id);
    expect(result.status).toBe('ACCEPTED');
    expect(calls).toHaveLength(1);
    expect(oldRows.every((row) => row.status === 'SKIPPED')).toBe(true);
    expect(rows.some((row) => row.reportDate.toISOString().slice(0, 10) === '2090-01-14' && row.shift === 'บ่าย')).toBe(true);
  });
});
