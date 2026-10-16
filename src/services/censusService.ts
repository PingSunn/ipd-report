import type {
  CensusRecord,
  DeleteCensusResponse,
  SaveCensusResponse,
  ShiftType,
} from '../types/census';
import { sortRecordsDesc } from '../utils/censusUtils';

type ServerCensusResponse = {
  success: boolean;
  records?: unknown;
  record?: unknown;
  serverTime?: unknown;
  message?: unknown;
  error?: unknown;
};

class CensusApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CensusApiError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isShift(value: unknown): value is ShiftType {
  return value === 'เช้า' || value === 'บ่าย' || value === 'ดึก';
}

function isAttribution(value: unknown): boolean {
  return (
    isObject(value) &&
    (typeof value.id === 'string' || value.id === null) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0
  );
}

function isCensusRecord(value: unknown): value is CensusRecord {
  if (!isObject(value)) return false;
  const requiredNumbers = [
    'totalPatients',
    'capacity',
    'availableBeds',
    'newPatients',
    'discharges',
    'referrals',
    'cat1',
    'cat2',
    'cat3',
    'cat4',
    'cat5',
  ];
  return (
    typeof value.id === 'string' &&
    typeof value.date === 'string' &&
    isShift(value.shift) &&
    typeof value.note === 'string' &&
    (value.lineNote === undefined || typeof value.lineNote === 'string') &&
    typeof value.updatedAt === 'string' &&
    requiredNumbers.every(
      (field) => typeof value[field] === 'number' && Number.isFinite(value[field])
    ) &&
    (value.createdBy === undefined || isAttribution(value.createdBy)) &&
    (value.updatedBy === undefined || isAttribution(value.updatedBy))
  );
}

function errorMessage(value: unknown, fallback: string): string {
  if (isObject(value) && typeof value.error === 'string' && value.error.trim()) {
    return value.error;
  }
  return fallback;
}

async function readResponse(response: Response): Promise<ServerCensusResponse> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = undefined;
  }
  if (!isObject(value) || typeof value.success !== 'boolean') {
    return { success: false };
  }

  return {
    success: value.success,
    records: value.records,
    record: value.record,
    serverTime: value.serverTime,
    message: value.message,
    error: value.error,
  };
}

function rethrowRequestError(error: unknown, fallback: string): never {
  if (error instanceof CensusApiError) {
    throw error;
  }
  throw new Error(fallback);
}

/** Fetch the latest records from the Next.js API. */
export async function getCensusRecords(): Promise<{
  records: CensusRecord[];
  source: 'server';
  syncedAt: string;
}> {
  try {
    const response = await fetch(`/api/census?_t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const data = await readResponse(response);
    if (!response.ok || !data.success || !Array.isArray(data.records)) {
      throw new CensusApiError(errorMessage(data, 'ไม่สามารถโหลดข้อมูลได้ในขณะนี้'));
    }

    if (!data.records.every(isCensusRecord)) {
      throw new CensusApiError('ข้อมูลที่ได้รับจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }

    return {
      records: sortRecordsDesc(data.records),
      source: 'server',
      syncedAt: typeof data.serverTime === 'string' ? data.serverTime : new Date().toISOString(),
    };
  } catch (error: unknown) {
    rethrowRequestError(error, 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อโหลดข้อมูลได้');
  }
}

/** Insert or update a census record through the Next.js API. */
export async function saveCensusRecord(record: CensusRecord): Promise<SaveCensusResponse> {
  const payload: CensusRecord = { ...record, updatedAt: new Date().toISOString() };
  delete payload.createdBy;
  delete payload.updatedBy;

  try {
    const response = await fetch('/api/census', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    const data = await readResponse(response);
    if (!response.ok || !data.success || !isCensusRecord(data.record)) {
      throw new CensusApiError(errorMessage(data, 'ไม่สามารถบันทึกข้อมูลได้ในขณะนี้'));
    }

    return {
      success: true,
      message: typeof data.message === 'string' ? data.message : 'บันทึกสำเร็จ',
      record: data.record,
    };
  } catch (error: unknown) {
    rethrowRequestError(error, 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกข้อมูลได้');
  }
}

/** Delete a census record by ID through the Next.js API. */
export async function deleteCensusRecord(id: string): Promise<DeleteCensusResponse> {
  try {
    const response = await fetch(`/api/census/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await readResponse(response);
    if (!response.ok || !data.success) {
      throw new CensusApiError(errorMessage(data, 'ไม่สามารถลบข้อมูลได้ในขณะนี้'));
    }
    return { success: true };
  } catch (error: unknown) {
    rethrowRequestError(error, 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อลบข้อมูลได้');
  }
}
