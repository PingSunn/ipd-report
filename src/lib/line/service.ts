import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type CensusRecord as PrismaCensusRecord, type Prisma } from '../../generated/prisma/client';
import { withLineConfigLock } from '../line-config-lock';
import { generateMissingMessage, generateReportMessage, splitLineText } from './messages';
import { latestDueSlot } from './time';
import {
  LINE_RETRY_KEY_WINDOW_MS,
  type LineCensusRecord,
  type LineDeliveryView,
  type LineScheduledSlot,
  type LineServiceDependencies,
  type LineSettingsSnapshot,
  type LineShift,
  type LineTickResult,
  type LineTransport,
} from './types';
import { LineApiTransport } from './transport';

const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 6;
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;
const SETTINGS_ID = 'default';
const PROVIDER_CAS_BUFFER_MS = 100;
type LineTransaction = Prisma.TransactionClient;

export interface LineServiceOptions extends Partial<LineServiceDependencies> {
  prisma?: PrismaClient;
  transport?: LineTransport;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateAtUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toCensusRecord(record: PrismaCensusRecord): LineCensusRecord {
  return {
    id: record.id,
    date: dateOnly(record.date),
    shift: record.shift as LineShift,
    totalPatients: record.totalPatients,
    capacity: record.capacity,
    availableBeds: record.availableBeds,
    newPatients: record.newPatients,
    discharges: record.discharges,
    referrals: record.referrals,
    cat1: record.cat1,
    cat2: record.cat2,
    cat3: record.cat3,
    cat4: record.cat4,
    cat5: record.cat5,
    note: record.note,
    lineNote: record.lineNote,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function settingsSnapshot(value: {
  hospitalName: string;
  wardName: string;
  reportFormat: string;
  includeCapacityAndOccupancy: boolean;
  includeCategories: boolean;
  includeWorkloadHours: boolean;
  includeNote: boolean;
  lineEnabled: boolean;
  lineGroupId: string;
  nightSendTime: string;
  morningSendTime: string;
  afternoonSendTime: string;
}): LineSettingsSnapshot {
  return {
    hospitalName: value.hospitalName,
    wardName: value.wardName,
    reportFormat: value.reportFormat as LineSettingsSnapshot['reportFormat'],
    includeCapacityAndOccupancy: value.includeCapacityAndOccupancy,
    includeCategories: value.includeCategories,
    includeWorkloadHours: value.includeWorkloadHours,
    includeNote: value.includeNote,
    lineEnabled: value.lineEnabled,
    lineGroupId: value.lineGroupId,
    nightSendTime: value.nightSendTime,
    morningSendTime: value.morningSendTime,
    afternoonSendTime: value.afternoonSendTime,
  };
}

export class LineService {
  private readonly prisma: PrismaClient;
  private readonly transport: LineTransport;
  private readonly now: () => Date;
  private readonly tokenConfigured: () => boolean;
  private readonly settingsGetter?: () => Promise<LineSettingsSnapshot>;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private ticking = false;

  constructor(options: LineServiceOptions = {}) {
    if (options.prisma) {
      this.prisma = options.prisma;
    } else {
      const connectionString = process.env['DATABASE_URL'];
      if (!connectionString) throw new Error('DATABASE_URL is not configured');
      this.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    }
    this.transport = options.transport ?? new LineApiTransport();
    this.now = options.now ?? (() => new Date());
    this.tokenConfigured = options.tokenConfigured ?? (() => Boolean(process.env['LINE_CHANNEL_ACCESS_TOKEN']?.trim()));
    this.settingsGetter = options.settingsGetter;
    this.workerId = options.workerId ?? `line-worker-${process.pid}-${crypto.randomUUID()}`;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async tick(): Promise<LineTickResult> {
    if (this.ticking) {
      return { heartbeatAt: this.now(), deliveryId: null, action: 'IDLE' };
    }
    this.ticking = true;
    const now = this.now();
    try {
      await this.heartbeat(now);
      const settings = await this.readSettings();
      if (!settings.lineEnabled || !this.tokenConfigured() || !settings.lineGroupId.trim()) {
        return { heartbeatAt: now, deliveryId: null, action: 'DISABLED' };
      }

      const latest = latestDueSlot(now, settings);
      if (!latest) return { heartbeatAt: now, deliveryId: null, action: 'IDLE' };
      await this.skipObsolete(latest, settings.lineGroupId, now);
      const ensured = await this.ensureDelivery(latest, settings);
      const claimed = await this.claimDue(now);
      if (!claimed) {
        return {
          heartbeatAt: now,
          deliveryId: ensured?.id ?? null,
          action: ensured ? 'CREATED' : 'IDLE',
          status: ensured?.status as LineDeliveryView['status'] | undefined,
        };
      }
      return await this.deliver(claimed, now);
    } finally {
      this.ticking = false;
    }
  }

  async heartbeat(at = this.now()): Promise<void> {
    await this.prisma.lineWorkerState.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, lastSeenAt: at },
      update: { lastSeenAt: at },
    });
  }

  async listHistory(limit = 100): Promise<LineDeliveryView[]> {
    const rows = await this.prisma.lineDelivery.findMany({
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.max(1, Math.min(limit, 500)),
    });
    return rows.map((row) => ({
      id: row.id,
      reportDate: dateOnly(row.reportDate),
      shift: row.shift,
      scheduledAt: row.scheduledAt,
      kind: row.kind as LineDeliveryView['kind'],
      status: row.status as LineDeliveryView['status'],
      groupId: row.groupId,
      attempts: row.attempts,
      firstAttemptAt: row.firstAttemptAt,
      nextAttemptAt: row.nextAttemptAt,
      acceptedAt: row.acceptedAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  private async ensureDelivery(slot: LineScheduledSlot, settings: LineSettingsSnapshot) {
    const key = {
      line_delivery_report_date_shift_key: {
        reportDate: dateAtUtcMidnight(slot.reportDate),
        shift: slot.shift,
      },
    };
    const existing = await this.prisma.lineDelivery.findUnique({ where: key });
    if (existing) return existing;

    const census = await this.prisma.censusRecord.findUnique({
      where: {
        census_record_date_shift_key: {
          date: dateAtUtcMidnight(slot.reportDate),
          shift: slot.shift,
        },
      },
    });
    const kind = census ? 'REPORT' : 'MISSING';
    const messageText = census
      ? generateReportMessage(toCensusRecord(census), settings)
      : generateMissingMessage(slot.reportDate, slot.shift, settings);
    try {
      return await this.prisma.lineDelivery.create({
        data: {
          reportDate: dateAtUtcMidnight(slot.reportDate),
          shift: slot.shift,
          scheduledAt: slot.scheduledAt,
          kind,
          status: 'PENDING',
          messageText,
          groupId: settings.lineGroupId,
          nextAttemptAt: null,
        },
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return this.prisma.lineDelivery.findUnique({ where: key });
      throw error;
    }
  }

  private async skipObsolete(slot: LineScheduledSlot, currentGroupId: string, now: Date): Promise<void> {
    const leaseExpired = new Date(now.getTime() - this.leaseMs);
    const candidates = await this.prisma.lineDelivery.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', claimedAt: { lt: leaseExpired } },
          { status: 'FAILED', nextAttemptAt: { not: null } },
        ],
      },
    });
    for (const row of candidates) {
      const obsolete = row.scheduledAt.getTime() < slot.scheduledAt.getTime();
      const staleGroup = row.groupId !== currentGroupId;
      if (!obsolete && (!staleGroup || row.status === 'PROCESSING')) continue;
      const claimGuard = row.status === 'PROCESSING'
        ? { status: 'PROCESSING', claimedAt: row.claimedAt, leaseOwner: row.leaseOwner }
        : { status: row.status };
      await this.prisma.lineDelivery.updateMany({
        where: { id: row.id, ...claimGuard },
        data: {
          status: 'SKIPPED',
          claimedAt: null,
          leaseOwner: null,
          nextAttemptAt: null,
          lastError: staleGroup
            ? 'Skipped because the configured LINE group changed before delivery'
            : 'Skipped as an obsolete pending or retryable slot after worker catch-up',
          updatedAt: now,
        },
      });
    }
  }

  private async claimDue(now: Date) {
    const leaseExpired = new Date(now.getTime() - this.leaseMs);
    const candidate = await this.prisma.lineDelivery.findFirst({
      where: {
        OR: [
          {
            status: 'PENDING',
            scheduledAt: { lte: now },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: 'FAILED',
            scheduledAt: { lte: now },
            nextAttemptAt: { lte: now },
          },
          {
            status: 'PROCESSING',
            claimedAt: { lt: leaseExpired },
            scheduledAt: { lte: now },
          },
        ],
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) return null;

    const guard = candidate.status === 'PROCESSING'
      ? { status: 'PROCESSING', claimedAt: candidate.claimedAt, leaseOwner: candidate.leaseOwner }
      : { status: candidate.status };
    const result = await this.prisma.lineDelivery.updateMany({
      where: { id: candidate.id, ...guard },
      data: {
        status: 'PROCESSING',
        claimedAt: now,
        leaseOwner: this.workerId,
        attempts: { increment: 1 },
        firstAttemptAt: candidate.firstAttemptAt ?? now,
        nextAttemptAt: null,
      },
    });
    if (result.count !== 1) return null;
    const claimed = await this.prisma.lineDelivery.findUnique({ where: { id: candidate.id } });
    return claimed?.leaseOwner === this.workerId && claimed.status === 'PROCESSING' ? claimed : null;
  }

  private async deliver(row: NonNullable<Awaited<ReturnType<LineService['claimDue']>>>, now: Date): Promise<LineTickResult> {
    let messages: readonly { type: 'text'; text: string }[];
    try {
      messages = splitLineText(row.messageText).map((text) => ({ type: 'text' as const, text }));
    } catch {
      await this.markFailed(row.id, 'LINE message is empty or exceeds the provider message limit', now);
      return { heartbeatAt: now, deliveryId: row.id, action: 'FAILED', status: 'FAILED' };
    }

    return withLineConfigLock(this.prisma, async (transaction, context) => {
      const providerController = new AbortController();
      const providerTimeout = Math.max(1, Math.min(10_000, context.remainingMs() - PROVIDER_CAS_BUFFER_MS));
      const timer = setTimeout(() => providerController.abort(), providerTimeout);
      try {
        return await this.dispatchInLockedTransaction(
          transaction,
          row,
          messages,
          now,
          providerController.signal,
          context.remainingMs,
        );
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async dispatchInLockedTransaction(
    transaction: LineTransaction,
    row: NonNullable<Awaited<ReturnType<LineService['claimDue']>>>,
    messages: readonly { type: 'text'; text: string }[],
    now: Date,
    signal: AbortSignal,
    assertCommitBudget: () => number,
  ): Promise<LineTickResult> {
    const settings = await this.readSettingsForTransaction(transaction);
    const leaseWhere = { id: row.id, status: 'PROCESSING', leaseOwner: this.workerId };
    if (!settings.lineEnabled || !this.tokenConfigured() || !settings.lineGroupId.trim()) {
      await transaction.lineDelivery.updateMany({
        where: leaseWhere,
        data: { status: 'PENDING', claimedAt: null, leaseOwner: null, nextAttemptAt: null, lastError: 'LINE delivery disabled or not configured', updatedAt: now },
      });
      return { heartbeatAt: now, deliveryId: row.id, action: 'DISABLED', status: 'PENDING' };
    }
    if (settings.lineGroupId !== row.groupId) {
      await transaction.lineDelivery.updateMany({
        where: leaseWhere,
        data: { status: 'SKIPPED', claimedAt: null, leaseOwner: null, nextAttemptAt: null, lastError: 'Skipped because the configured LINE group changed before delivery', updatedAt: now },
      });
      return { heartbeatAt: now, deliveryId: row.id, action: 'SKIPPED', status: 'SKIPPED' };
    }
    const verifiedGroup = await transaction.verifiedLineGroup.findUnique({ where: { groupId: row.groupId } });
    if (!verifiedGroup) {
      await transaction.lineDelivery.updateMany({
        where: leaseWhere,
        data: { status: 'SKIPPED', claimedAt: null, leaseOwner: null, nextAttemptAt: null, lastError: 'Skipped because the destination LINE group is no longer verified', updatedAt: now },
      });
      return { heartbeatAt: now, deliveryId: row.id, action: 'SKIPPED', status: 'SKIPPED' };
    }
    if (row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= LINE_RETRY_KEY_WINDOW_MS) {
      await transaction.lineDelivery.updateMany({
        where: leaseWhere,
        data: { status: 'FAILED', claimedAt: null, leaseOwner: null, nextAttemptAt: null, lastError: 'Retry-key safety window expired before provider acceptance', updatedAt: now },
      });
      return { heartbeatAt: now, deliveryId: row.id, action: 'FAILED', status: 'FAILED' };
    }

    let result;
    try {
      result = await this.transport.push({ to: row.groupId, messages, retryKey: row.retryKey, signal });
    } catch {
      result = { accepted: false as const, retryable: true, reason: 'LINE transport error' };
    }
    // The helper reserves the remaining budget for this transaction's CAS and commit.
    assertCommitBudget();
    if (result.accepted) {
      const updated = await transaction.lineDelivery.updateMany({
        where: leaseWhere,
        data: {
          status: 'ACCEPTED',
          acceptedAt: now,
          // Provider acceptance is the retention boundary: keep delivery
          // metadata, but erase the report body immediately in the same CAS.
          messageText: '',
          claimedAt: null,
          leaseOwner: null,
          nextAttemptAt: null,
          lastError: null,
          updatedAt: now,
        },
      });
      return updated.count === 1
        ? { heartbeatAt: now, deliveryId: row.id, action: 'SENT', status: 'ACCEPTED' }
        : { heartbeatAt: now, deliveryId: row.id, action: 'IDLE' };
    }

    const exhausted = !result.retryable || row.attempts >= this.maxAttempts;
    const agedOut = row.firstAttemptAt
      ? now.getTime() - row.firstAttemptAt.getTime() >= LINE_RETRY_KEY_WINDOW_MS
      : false;
    if (exhausted || agedOut) {
      await transaction.lineDelivery.updateMany({
        where: leaseWhere,
        data: { status: 'FAILED', claimedAt: null, leaseOwner: null, nextAttemptAt: null, lastError: agedOut ? 'Retry-key safety window expired before provider acceptance' : result.reason, updatedAt: now },
      });
      return { heartbeatAt: now, deliveryId: row.id, action: 'FAILED', status: 'FAILED' };
    }
    const backoff = RETRY_BACKOFF_MS[Math.min(row.attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? RETRY_BACKOFF_MS.at(-1)!;
    await transaction.lineDelivery.updateMany({
      where: leaseWhere,
      data: { status: 'FAILED', claimedAt: null, leaseOwner: null, nextAttemptAt: new Date(now.getTime() + backoff), lastError: result.reason, updatedAt: now },
    });
    return { heartbeatAt: now, deliveryId: row.id, action: 'RETRY', status: 'FAILED' };
  }

  private async markFailed(id: string, reason: string, now: Date): Promise<void> {
    await this.prisma.lineDelivery.updateMany({
      where: { id, status: 'PROCESSING', leaseOwner: this.workerId },
      data: { status: 'FAILED', claimedAt: null, leaseOwner: null, nextAttemptAt: null, lastError: reason, updatedAt: now },
    });
  }

  private async readSettings(): Promise<LineSettingsSnapshot> {
    if (this.settingsGetter) return this.settingsGetter();
    return this.readSettingsFromDatabase();
  }

  private async readSettingsForTransaction(transaction: LineTransaction): Promise<LineSettingsSnapshot> {
    if (this.settingsGetter) return this.settingsGetter();
    const existing = await transaction.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (existing) return settingsSnapshot(existing);
    const { defaultSettingsValues } = await import('../settings');
    return settingsSnapshot(await transaction.appSettings.create({
      data: { id: SETTINGS_ID, ...defaultSettingsValues() },
    }));
  }

  private async readSettingsFromDatabase(): Promise<LineSettingsSnapshot> {
    const existing = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (existing) return settingsSnapshot(existing);
    try {
      const { defaultSettingsValues } = await import('../settings');
      const created = await this.prisma.appSettings.create({
        data: { id: SETTINGS_ID, ...defaultSettingsValues() },
      });
      return settingsSnapshot(created);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        const createdByOtherWorker = await this.prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
        if (createdByOtherWorker) return settingsSnapshot(createdByOtherWorker);
      }
      throw error;
    }
  }
}

export function createLineService(options: LineServiceOptions = {}): LineService {
  return new LineService(options);
}
