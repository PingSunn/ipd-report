import type { Prisma, PrismaClient } from '../generated/prisma/client';

// Stable signed 32-bit key shared by settings mutations, webhook revocation,
// and the worker's final settings check before provider dispatch.
export const LINE_CONFIG_LOCK_KEY = 1_347_291_601 as const;

export const LINE_CONFIG_LOCK_OPTIONS = {
  maxWait: 5_000,
  timeout: 15_000,
} as const;

export const LINE_CONFIG_LOCK_TIMEOUT_MS = 2_000 as const;
export const LINE_CONFIG_COMMIT_MARGIN_MS = 1_000 as const;

export interface LineConfigLockRequest {
  /** Absolute epoch deadline for the whole transaction, including lock wait. */
  deadlineAt?: number;
  /** Abort signal owned by the worker's provider request budget. */
  signal?: AbortSignal;
  /** Time reserved for the final database update before the deadline. */
  commitMarginMs?: number;
}

export interface LineConfigLockContext {
  readonly deadlineAt: number;
  readonly commitDeadlineAt: number;
  readonly signal?: AbortSignal;
  remainingMs(): number;
}

export async function withLineConfigLock<T>(
  prisma: PrismaClient,
  callback: (
    transaction: Prisma.TransactionClient,
    context: LineConfigLockContext,
  ) => Promise<T>,
  request: LineConfigLockRequest = {},
): Promise<T> {
  const txTimeoutMs = LINE_CONFIG_LOCK_OPTIONS.timeout;
  const deadlineAt = request.deadlineAt ?? Date.now() + txTimeoutMs;
  const commitMarginMs = request.commitMarginMs ?? LINE_CONFIG_COMMIT_MARGIN_MS;
  const commitDeadlineAt = deadlineAt - commitMarginMs;
  const remainingBeforeTransaction = Math.max(1, deadlineAt - Date.now());
  const transactionOptions = {
    maxWait: Math.min(LINE_CONFIG_LOCK_OPTIONS.maxWait, remainingBeforeTransaction),
    timeout: Math.min(LINE_CONFIG_LOCK_OPTIONS.timeout, remainingBeforeTransaction),
  } as const;
  const context: LineConfigLockContext = {
    deadlineAt,
    commitDeadlineAt,
    signal: request.signal,
    remainingMs: () => {
      assertBudget();
      return Math.max(0, commitDeadlineAt - Date.now());
    },
  };
  const assertBudget = (): void => {
    if (request.signal?.aborted) throw new Error('LINE configuration lock request aborted');
    if (Date.now() >= commitDeadlineAt) {
      throw new Error('LINE configuration lock deadline expired');
    }
  };

  assertBudget();
  return prisma.$transaction(async (transaction) => {
    assertBudget();
    await transaction.$executeRaw`SET LOCAL lock_timeout = '2s'`;
    assertBudget();
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${LINE_CONFIG_LOCK_KEY})`;
    assertBudget();
    return callback(transaction, context);
  }, transactionOptions);
}
