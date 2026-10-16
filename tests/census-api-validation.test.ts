import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
    censusRecord: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/authorization', () => ({
  requireUser: vi.fn(async () => ({ id: 'test-user', email: 'test@gmail.com', name: 'Test', role: 'nurse' })),
  authErrorResponse: vi.fn(() => Response.json({ success: false }, { status: 401 })),
}));

import { POST } from '../src/app/api/census/route';

type CensusPayload = {
  id: string;
  date: string;
  shift: 'เช้า' | 'บ่าย' | 'ดึก';
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
  note: string;
};

const payload: CensusPayload = {
  id: 'REC-20261014-M',
  date: '2026-10-14',
  shift: 'เช้า',
  totalPatients: 12,
  capacity: 30,
  availableBeds: 18,
  newPatients: 2,
  discharges: 1,
  referrals: 0,
  cat1: 2,
  cat2: 3,
  cat3: 4,
  cat4: 2,
  cat5: 1,
  note: 'ตรวจสอบแล้ว',
};

function dbRecord(overrides: Partial<CensusPayload> & { id?: string } = {}) {
  const value = { ...payload, ...overrides };
  return {
    ...value,
    date: new Date(`${value.date}T00:00:00.000Z`),
    updatedAt: new Date('2026-10-14T08:00:00.000Z'),
  };
}

function post(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/census', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) =>
    callback(mockPrisma)
  );
});

describe('POST /api/census validation and upsert behavior', () => {
  it('accepts the browser origin when a trusted reverse proxy forwards host and protocol', async () => {
    const existing = dbRecord({ id: payload.id });
    mockPrisma.censusRecord.findUnique.mockResolvedValue(existing);
    mockPrisma.censusRecord.update.mockResolvedValue(existing);

    const response = await POST(
      post(payload, {
        origin: 'https://census.example.org',
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'census.example.org',
        'x-forwarded-proto': 'https',
      })
    );

    expect(response.status).toBe(200);
  });

  it('rejects a foreign origin against the trusted forwarded host', async () => {
    const response = await POST(
      post(payload, {
        origin: 'https://evil.example.org',
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'census.example.org',
        'x-forwarded-proto': 'https',
      })
    );

    expect(response.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a foreign origin on a direct request', async () => {
    const response = await POST(
      post(payload, {
        origin: 'https://evil.example.org',
        host: '127.0.0.1:3000',
      })
    );

    expect(response.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('updates an existing record by ID when its date or shift changes', async () => {
    const existing = dbRecord({ id: payload.id });
    const moved = dbRecord({ id: payload.id, date: '2026-10-15', shift: 'บ่าย' });
    mockPrisma.censusRecord.findUnique.mockResolvedValue(existing);
    mockPrisma.censusRecord.update.mockResolvedValue(moved);

    const response = await POST(
      post({ ...payload, date: '2026-10-15', shift: 'บ่าย', totalPatients: 20 })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.record.id).toBe(payload.id);
    expect(mockPrisma.censusRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: payload.id } })
    );
    expect(mockPrisma.censusRecord.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        date: new Date('2026-10-15T00:00:00.000Z'),
        shift: 'บ่าย',
        totalPatients: 20,
      })
    );
    expect(mockPrisma.censusRecord.upsert).not.toHaveBeenCalled();
  });

  it('falls back to date/shift upsert when the submitted ID is new', async () => {
    const existingAtDateShift = dbRecord({ id: 'REC-OTHER-ID' });
    mockPrisma.censusRecord.findUnique.mockResolvedValue(null);
    mockPrisma.censusRecord.upsert.mockResolvedValue(existingAtDateShift);

    const response = await POST(post(payload));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.record.id).toBe('REC-OTHER-ID');
    expect(mockPrisma.censusRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          census_record_date_shift_key: {
            date: new Date('2026-10-14T00:00:00.000Z'),
            shift: 'เช้า',
          },
        },
        create: expect.objectContaining({ id: payload.id }),
      })
    );
  });

  it.each([
    ['rejects impossible calendar dates', { date: '2026-02-29' }],
    ['rejects negative counts', { totalPatients: -1 }],
    ['rejects values beyond the PostgreSQL integer range', { capacity: 2147483648 }],
  ])('%s with a 400 response', async (_description, change) => {
    const response = await POST(post({ ...payload, ...change }));

    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
