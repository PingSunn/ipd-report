import { expect, test, type APIRequestContext } from '@playwright/test';

type CensusRecord = {
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
  updatedAt?: string;
};

type ApiBody = {
  success: boolean;
  records?: CensusRecord[];
  record?: CensusRecord;
  error?: string;
};

const runToken = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const ids = {
  moved: `QA-TEMP-${runToken}-MOVED`,
  dateShift: `QA-TEMP-${runToken}-DATE`,
  dateShiftOther: `QA-TEMP-${runToken}-OTHER`,
  conflictA: `QA-TEMP-${runToken}-CONFLICT-A`,
  conflictB: `QA-TEMP-${runToken}-CONFLICT-B`,
};

const baseRecord: Omit<CensusRecord, 'id' | 'updatedAt'> = {
  date: '2090-01-10',
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
  note: 'QA temporary',
};

function payload(id: string, overrides: Partial<CensusRecord> = {}): CensusRecord {
  return { id, ...baseRecord, ...overrides };
}

async function post(
  request: APIRequestContext,
  body: unknown,
  headers?: Record<string, string>
) {
  return request.post('/api/census', {
    data: body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test.describe('live census API', () => {
  test('supports CRUD, ID edits, date/shift upserts, and conflict errors', async ({ request }) => {
    const recordsToDelete = new Set(Object.values(ids));

    try {
      const initial = await request.get('/api/census');
      expect(initial.status()).toBe(200);
      const initialBody = (await initial.json()) as ApiBody;
      expect(initialBody).toMatchObject({ success: true, records: [] });

      const created = await post(request, payload(ids.moved));
      expect(created.status()).toBe(200);
      const createdBody = (await created.json()) as ApiBody;
      expect(createdBody.record).toMatchObject({
        id: ids.moved,
        date: '2090-01-10',
        shift: 'เช้า',
        note: 'QA temporary',
      });
      const moved = await post(
        request,
        payload(ids.moved, {
          date: '2090-01-11',
          shift: 'บ่าย',
          totalPatients: 20,
        })
      );
      expect(moved.status()).toBe(200);
      const movedBody = (await moved.json()) as ApiBody;
      expect(movedBody.record).toMatchObject({
        id: ids.moved,
        date: '2090-01-11',
        shift: 'บ่าย',
        totalPatients: 20,
      });

      const sameDateShift = await post(
        request,
        payload(ids.dateShift, {
          date: '2090-01-12',
          shift: 'ดึก',
          totalPatients: 8,
        })
      );
      expect(sameDateShift.status()).toBe(200);
      const sameDateShiftBody = (await sameDateShift.json()) as ApiBody;
      expect(sameDateShiftBody.record?.id).toBe(ids.dateShift);
      const sameDateShiftUpsert = await post(
        request,
        payload(ids.dateShiftOther, {
          date: '2090-01-12',
          shift: 'ดึก',
          totalPatients: 9,
        })
      );
      expect(sameDateShiftUpsert.status()).toBe(200);
      const upsertBody = (await sameDateShiftUpsert.json()) as ApiBody;
      expect(upsertBody.record).toMatchObject({
        id: ids.dateShift,
        date: '2090-01-12',
        shift: 'ดึก',
        totalPatients: 9,
      });
      expect(upsertBody.record?.id).not.toBe(ids.dateShiftOther);

      const conflictA = await post(
        request,
        payload(ids.conflictA, { date: '2090-01-13', shift: 'เช้า' })
      );
      expect(conflictA.status()).toBe(200);
      const conflictB = await post(
        request,
        payload(ids.conflictB, { date: '2090-01-13', shift: 'บ่าย' })
      );
      expect(conflictB.status()).toBe(200);
      const conflictingMove = await post(
        request,
        payload(ids.conflictA, { date: '2090-01-13', shift: 'บ่าย' })
      );
      expect(conflictingMove.status()).toBe(409);
      expect(((await conflictingMove.json()) as ApiBody).error?.length).toBeGreaterThan(0);

      const afterConflict = await request.get('/api/census');
      expect(afterConflict.status()).toBe(200);
      const afterConflictBody = (await afterConflict.json()) as ApiBody;
      expect(afterConflictBody.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids.conflictA, date: '2090-01-13', shift: 'เช้า' }),
          expect.objectContaining({ id: ids.conflictB, date: '2090-01-13', shift: 'บ่าย' }),
        ])
      );

      const deleted = await request.delete(`/api/census/${encodeURIComponent(ids.moved)}`);
      expect(deleted.status()).toBe(200);
      expect(((await deleted.json()) as ApiBody).success).toBe(true);
      recordsToDelete.delete(ids.moved);

      const missingDelete = await request.delete(`/api/census/${encodeURIComponent(ids.moved)}`);
      expect(missingDelete.status()).toBe(404);
    } finally {
      for (const id of recordsToDelete) {
        const response = await request.delete(`/api/census/${encodeURIComponent(id)}`);
        expect([200, 404]).toContain(response.status());
      }
    }
  });

  test('rejects invalid counts, fractions, impossible dates, unsupported shifts, and cross-origin writes', async ({ request }) => {
    const invalidIds = {
      negative: `QA-TEMP-${runToken}-NEG`,
      fraction: `QA-TEMP-${runToken}-FRACTION`,
      date: `QA-TEMP-${runToken}-DATE`,
      shift: `QA-TEMP-${runToken}-SHIFT`,
      origin: `QA-TEMP-${runToken}-ORIGIN`,
    };
    const recordsToDelete = new Set(Object.values(invalidIds));
    const invalidCases: Array<{ name: string; body: CensusRecord }> = [
      { name: 'negative count', body: payload(invalidIds.negative, { totalPatients: -1 }) },
      { name: 'fractional count', body: payload(invalidIds.fraction, { totalPatients: 1.5 }) },
      { name: 'impossible date', body: payload(invalidIds.date, { date: '2090-02-29' }) },
      {
        name: 'unsupported shift',
        body: payload(invalidIds.shift, { shift: 'night' as CensusRecord['shift'] }),
      },
    ];

    try {
      for (const invalidCase of invalidCases) {
        const response = await post(request, invalidCase.body);
        expect(response.status(), invalidCase.name).toBe(400);
        expect(((await response.json()) as ApiBody).success, invalidCase.name).toBe(false);
      }

      const crossOrigin = await post(request, payload(invalidIds.origin), {
        origin: 'https://evil.example',
      });
      expect(crossOrigin.status()).toBe(403);
      expect(((await crossOrigin.json()) as ApiBody).success).toBe(false);

      const records = await request.get('/api/census');
      expect(records.status()).toBe(200);
      expect(((await records.json()) as ApiBody).records).toEqual([]);
    } finally {
      for (const id of recordsToDelete) {
        const response = await request.delete(`/api/census/${encodeURIComponent(id)}`);
        expect([200, 404]).toContain(response.status());
      }
    }
  });
});
