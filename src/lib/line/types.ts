import type { PrismaClient } from '../../generated/prisma/client';

export const LINE_TIMEZONE = 'Asia/Bangkok' as const;
export const LINE_MAX_TEXT_LENGTH = 5000;
export const LINE_MAX_MESSAGES = 5;
export const LINE_RETRY_KEY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type LineShift = 'เช้า' | 'บ่าย' | 'ดึก';
export type LineDeliveryKind = 'REPORT' | 'MISSING';
export type LineDeliveryStatus = 'PENDING' | 'PROCESSING' | 'ACCEPTED' | 'FAILED' | 'SKIPPED';

export interface LineSettingsSnapshot {
  hospitalName: string;
  wardName: string;
  reportFormat: 'standard' | 'compact' | 'detailed';
  includeCapacityAndOccupancy: boolean;
  includeCategories: boolean;
  includeWorkloadHours: boolean;
  includeNote: boolean;
  lineEnabled: boolean;
  lineGroupId: string;
  nightSendTime: string;
  morningSendTime: string;
  afternoonSendTime: string;
}

export interface LineCensusRecord {
  id: string;
  date: string;
  shift: LineShift;
  totalPatients: number;
  capacity: number;
  availableBeds: number;
  newPatients: number;
  discharges: number;
  referrals: number;
  cat1: number;
  cat2: number;
  cat3: number;
  cat4: number;
  cat5: number;
  /** Retained for the shared summary type; never rendered by LINE generation. */
  note: string;
  /** LINE-safe note only; internal census notes are intentionally absent. */
  lineNote?: string;
  updatedAt: string;
}

export interface LineScheduledSlot {
  reportDate: string;
  shift: LineShift;
  scheduledAt: Date;
}

export interface LineTransportRequest {
  to: string;
  messages: readonly { type: 'text'; text: string }[];
  retryKey: string;
  signal?: AbortSignal;
}

export interface LineTransportAccepted {
  accepted: true;
  providerRequestId?: string;
}

export interface LineTransportRejected {
  accepted: false;
  retryable: boolean;
  status?: number;
  reason: string;
}

export type LineTransportResult = LineTransportAccepted | LineTransportRejected;

export interface LineTransport {
  push(request: LineTransportRequest): Promise<LineTransportResult>;
}

export interface LineServiceDependencies {
  prisma: PrismaClient;
  transport: LineTransport;
  now?: () => Date;
  tokenConfigured?: () => boolean;
  settingsGetter?: () => Promise<LineSettingsSnapshot>;
  workerId?: string;
  leaseMs?: number;
  maxAttempts?: number;
}

export interface LineTickResult {
  heartbeatAt: Date;
  deliveryId: string | null;
  action: 'DISABLED' | 'IDLE' | 'CREATED' | 'SENT' | 'RETRY' | 'FAILED' | 'SKIPPED';
  status?: LineDeliveryStatus;
}

export interface LineDeliveryView {
  id: string;
  reportDate: string;
  shift: string;
  scheduledAt: Date;
  kind: LineDeliveryKind;
  status: LineDeliveryStatus;
  groupId: string;
  attempts: number;
  firstAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  acceptedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
