import 'dotenv/config';

import { prisma } from '../src/lib/prisma';
import { addCalendarDays, bangkokDateString } from '../src/lib/line/time';
import { toDatabaseDate } from '../src/lib/census-validation';
import type { ShiftType } from '../src/types/census';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not configured');
if (process.env['ALLOW_MOCK_CENSUS_SEED'] !== '1') {
  throw new Error('Set ALLOW_MOCK_CENSUS_SEED=1 to seed mock census data');
}

const databaseUrl = new URL(connectionString);
const isDedicatedComposeDatabase =
  ['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) &&
  databaseUrl.port === '45432' &&
  databaseUrl.username === 'ipd_report' &&
  databaseUrl.pathname === '/ipd_report';
if (!isDedicatedComposeDatabase || process.env['NODE_ENV'] === 'production') {
  throw new Error('Mock census data can only be seeded into the dedicated Docker development database');
}

const today = bangkokDateString(new Date());
const firstDate = addCalendarDays(today, -3);
const secondDate = addCalendarDays(today, -2);
const note = 'ข้อมูลจำลองสำหรับทดสอบระบบ — ไม่มีผู้ป่วยจริง';

type MockRecord = {
  id: string;
  date: Date;
  shift: ShiftType;
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

function record(
  date: string,
  shift: ShiftType,
  totalPatients: number,
  movement: readonly [number, number, number],
  categories: readonly [number, number, number, number, number],
): MockRecord {
  const shiftCode = shift === 'ดึก' ? 'N' : shift === 'เช้า' ? 'M' : 'A';
  const capacity = 30;
  return {
    id: `MOCK-${date.replaceAll('-', '')}-${shiftCode}`,
    date: toDatabaseDate(date),
    shift,
    totalPatients,
    capacity,
    availableBeds: capacity - totalPatients,
    newPatients: movement[0],
    discharges: movement[1],
    referrals: movement[2],
    cat1: categories[0],
    cat2: categories[1],
    cat3: categories[2],
    cat4: categories[3],
    cat5: categories[4],
    note,
  };
}

function makeFixture(first: string, second: string): MockRecord[] {
  return [
    record(first, 'ดึก', 20, [1, 2, 0], [4, 6, 6, 3, 1]),
    record(first, 'เช้า', 23, [5, 2, 0], [5, 7, 7, 3, 1]),
    record(first, 'บ่าย', 22, [2, 2, 1], [4, 7, 7, 3, 1]),
    record(second, 'ดึก', 21, [1, 2, 0], [4, 6, 7, 3, 1]),
    record(second, 'เช้า', 25, [6, 2, 0], [5, 8, 7, 4, 1]),
    record(second, 'บ่าย', 24, [2, 2, 1], [5, 7, 7, 4, 1]),
  ];
}

const records = makeFixture(firstDate, secondDate);

try {
  const [settings, workerState, existingMockRecords] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { id: 'default' },
      select: { lineEnabled: true },
    }),
    prisma.lineWorkerState.findUnique({
      where: { id: 'default' },
      select: { lastSeenAt: true },
    }),
    prisma.censusRecord.findMany({
      where: { id: { startsWith: 'MOCK-' } },
      select: {
        id: true,
        date: true,
        shift: true,
        totalPatients: true,
        capacity: true,
        availableBeds: true,
        newPatients: true,
        discharges: true,
        referrals: true,
        cat1: true,
        cat2: true,
        cat3: true,
        cat4: true,
        cat5: true,
        note: true,
      },
    }),
  ]);
  if (settings?.lineEnabled) {
    throw new Error('Disable automatic LINE delivery before seeding mock census data');
  }
  if (
    workerState?.lastSeenAt &&
    workerState.lastSeenAt.getTime() >= Date.now() - 60_000
  ) {
    throw new Error('Stop the LINE worker before seeding mock census data');
  }
  if (existingMockRecords.length > 0) {
    const existingDates = [
      ...new Set(
        existingMockRecords.map(({ date }) => date.toISOString().slice(0, 10)),
      ),
    ].sort();
    const existingExpected =
      existingDates.length === 2 &&
      addCalendarDays(existingDates[0], 1) === existingDates[1]
        ? makeFixture(existingDates[0], existingDates[1])
        : [];
    const isCompleteFixture =
      existingMockRecords.length === existingExpected.length &&
      existingMockRecords.every((existing) => {
        const expected = existingExpected.find(({ id }) => id === existing.id);
        return Boolean(
          expected &&
          existing.date.getTime() === expected.date.getTime() &&
          existing.shift === expected.shift &&
          existing.totalPatients === expected.totalPatients &&
          existing.capacity === expected.capacity &&
          existing.availableBeds === expected.availableBeds &&
          existing.newPatients === expected.newPatients &&
          existing.discharges === expected.discharges &&
          existing.referrals === expected.referrals &&
          existing.cat1 === expected.cat1 &&
          existing.cat2 === expected.cat2 &&
          existing.cat3 === expected.cat3 &&
          existing.cat4 === expected.cat4 &&
          existing.cat5 === expected.cat5 &&
          existing.note === expected.note,
        );
      });
    if (!isCompleteFixture) {
      throw new Error('Existing MOCK records are incomplete or do not match this fixture');
    }
    console.log(`Mock census fixture already exists (${existingMockRecords.length} records); no changes made`);
  } else {
    const dates = [toDatabaseDate(firstDate), toDatabaseDate(secondDate)];
    const existing = await prisma.censusRecord.findMany({
      where: { date: { in: dates } },
      select: { date: true, shift: true },
    });
    if (existing.length > 0) {
      const conflicts = existing
        .map(({ date, shift }) => `${date.toISOString().slice(0, 10)} ${shift}`)
        .join(', ');
      throw new Error(`Refusing to overwrite existing census records: ${conflicts}`);
    }

    const result = await prisma.$transaction((transaction) =>
      transaction.censusRecord.createMany({ data: records }),
    );
    console.log(`Created ${result.count} mock census records for ${firstDate} and ${secondDate}`);
  }
} finally {
  await prisma.$disconnect();
}
