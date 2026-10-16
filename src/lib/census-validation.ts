import { z } from 'zod';
import type { CensusRecord as PrismaCensusRecord } from '../generated/prisma/client';
import type { ShiftType } from '../types/census';

const shifts: readonly [ShiftType, ShiftType, ShiftType] = ['เช้า', 'บ่าย', 'ดึก'];

const integerCount = z
  .number({ message: 'ค่าต้องเป็นตัวเลข' })
  .int('ค่าต้องเป็นจำนวนเต็ม')
  .min(0, 'ค่าต้องไม่ติดลบ')
  .max(2147483647, 'ค่าต้องไม่เกิน 2147483647');

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

const dateSchema = z
  .string({ message: 'กรุณาระบุวันที่' })
  .refine(isRealCalendarDate, 'วันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ yyyy-MM-dd');

export const censusRecordSchema = z
  .object({
    id: z
      .string({ message: 'กรุณาระบุรหัสรายการ' })
      .trim()
      .min(1, 'กรุณาระบุรหัสรายการ')
      .max(128, 'รหัสรายการยาวเกินไป'),
    date: dateSchema,
    shift: z.enum(shifts, { message: 'เวรไม่ถูกต้อง' }),
    totalPatients: integerCount,
    capacity: z
      .number({ message: 'ความจุต้องเป็นตัวเลข' })
      .int('ความจุต้องเป็นจำนวนเต็ม')
      .min(1, 'ความจุต้องมากกว่า 0')
      .max(2147483647, 'ความจุต้องไม่เกิน 2147483647'),
    availableBeds: integerCount,
    newPatients: integerCount,
    discharges: integerCount,
    referrals: integerCount,
    cat1: integerCount,
    cat2: integerCount,
    cat3: integerCount,
    cat4: integerCount,
    cat5: integerCount,
    note: z
      .string({ message: 'หมายเหตุต้องเป็นข้อความ' })
      .max(5000, 'หมายเหตุยาวเกินไป'),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type CensusRecordInput = z.infer<typeof censusRecordSchema>;

export function toDatabaseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

type CensusUserAttribution = {
  id: string;
  nickname: string | null;
};

type CensusRecordWithAttribution = PrismaCensusRecord & {
  createdBy: CensusUserAttribution | null;
  updatedBy: CensusUserAttribution | null;
};

export const UNKNOWN_CENSUS_AUTHOR = 'ระบบ/ไม่ทราบผู้บันทึก';

function toAuthorAttribution(user: CensusUserAttribution | null): {
  id: string | null;
  displayName: string;
} {
  const nickname = user?.nickname?.trim();
  return {
    id: user?.id ?? null,
    displayName: nickname || UNKNOWN_CENSUS_AUTHOR,
  };
}

export function toCensusRecord(record: CensusRecordWithAttribution) {
  return {
    id: record.id,
    date: record.date.toISOString().slice(0, 10),
    shift: record.shift as ShiftType,
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
    updatedAt: record.updatedAt.toISOString(),
    createdBy: toAuthorAttribution(record.createdBy),
    updatedBy: toAuthorAttribution(record.updatedBy),
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
      return false;
    }
    if (isConfiguredTrustedOrigin(originUrl)) return true;

    const requestUrl = new URL(request.url);
    const forwardedHost = firstForwardedValue(request.headers.get('x-forwarded-host'));
    const requestHost = forwardedHost ?? firstForwardedValue(request.headers.get('host'));
    if (!requestHost) return false;

    const forwardedProto = firstForwardedValue(request.headers.get('x-forwarded-proto'));
    if (forwardedHost && !forwardedProto) return false;

    const expectedProtocol = forwardedProto
      ? normalizeProtocol(forwardedProto)
      : requestUrl.protocol;
    if (!expectedProtocol || originUrl.protocol !== expectedProtocol) return false;

    const expectedHost = normalizeHost(requestHost, expectedProtocol);
    return expectedHost !== null && originUrl.host === expectedHost;
  } catch {
    return false;
  }
}

function isConfiguredTrustedOrigin(originUrl: URL): boolean {
  const configuredOrigins = process.env['BETTER_AUTH_TRUSTED_ORIGINS']
    ?? process.env['BETTER_AUTH_URL']
    ?? process.env['NEXT_PUBLIC_APP_URL']
    ?? '';

  return configuredOrigins.split(',').some((configuredOrigin) => {
    try {
      const trustedUrl = new URL(configuredOrigin.trim());
      return (trustedUrl.protocol === 'http:' || trustedUrl.protocol === 'https:')
        && trustedUrl.origin === originUrl.origin;
    } catch {
      return false;
    }
  });
}

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

function normalizeProtocol(value: string): string | null {
  const protocol = value.endsWith(':') ? value : `${value}:`;
  return protocol === 'http:' || protocol === 'https:' ? protocol : null;
}

function normalizeHost(value: string, protocol: string): string | null {
  try {
    return new URL(`${protocol}//${value}`).host;
  } catch {
    return null;
  }
}

export const supportedShifts = shifts;
