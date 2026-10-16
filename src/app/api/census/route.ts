import { NextResponse } from 'next/server';
import { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../lib/prisma';
import {
  censusRecordSchema,
  isSameOriginMutation,
  toCensusRecord,
  toDatabaseDate,
} from '../../../lib/census-validation';
import { authErrorResponse, requireUser, type AuthenticatedUser } from '../../../lib/authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

const attributionInclude = {
  createdBy: { select: { id: true, nickname: true } },
  updatedBy: { select: { id: true, nickname: true } },
} as const;

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function validationErrorResponse(): NextResponse {
  return jsonResponse(
    {
      success: false,
      error: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบวันที่ เวร และจำนวนที่กรอก',
    },
    400
  );
}

type CensusAuditSource = {
  id: string;
  date: Date;
  shift: string;
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

function censusAuditSnapshot(record: CensusAuditSource): Prisma.InputJsonObject {
  return {
    id: record.id,
    date: record.date.toISOString().slice(0, 10),
    shift: record.shift,
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
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireUser();
  } catch (error: unknown) {
    return authErrorResponse(error) as NextResponse;
  }
  try {
    const records = await prisma.censusRecord.findMany({
      orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }],
      include: attributionInclude,
    });

    return jsonResponse({
      success: true,
      records: records.map(toCensusRecord),
      serverTime: new Date().toISOString(),
    });
  } catch {
    return jsonResponse(
      {
        success: false,
        records: [],
        serverTime: new Date().toISOString(),
        error: 'ไม่สามารถโหลดข้อมูลได้ในขณะนี้',
      },
      503
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let actor: AuthenticatedUser;
  try {
    actor = await requireUser();
  } catch (error: unknown) {
    return authErrorResponse(error) as NextResponse;
  }
  if (!isSameOriginMutation(request)) {
    return jsonResponse({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse();
  }

  const parsed = censusRecordSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse();

  const input = parsed.data;
  let matchedExistingId = false;
  try {
    const saved = await prisma.$transaction(async (transaction) => {
      const existingById = await transaction.censusRecord.findUnique({
        where: { id: input.id },
      });
      const values = {
        date: toDatabaseDate(input.date),
        shift: input.shift,
        totalPatients: input.totalPatients,
        capacity: input.capacity,
        availableBeds: input.availableBeds,
        newPatients: input.newPatients,
        discharges: input.discharges,
        referrals: input.referrals,
        cat1: input.cat1,
        cat2: input.cat2,
        cat3: input.cat3,
        cat4: input.cat4,
        cat5: input.cat5,
        note: input.note,
      };

      if (existingById) {
        matchedExistingId = true;
        const updated = await transaction.censusRecord.update({
          where: { id: existingById.id },
          data: { ...values, updatedById: actor.id },
          include: attributionInclude,
        });
        await transaction.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'census.updated',
            entityType: 'census_record',
            entityId: updated.id,
            before: censusAuditSnapshot(existingById),
            after: censusAuditSnapshot(updated),
          },
        });
        return updated;
      }

      const existingByDateShift = await transaction.censusRecord.findUnique({
        where: {
          census_record_date_shift_key: {
            date: values.date,
            shift: values.shift,
          },
        },
      });
      const saved = await transaction.censusRecord.upsert({
        where: {
          census_record_date_shift_key: {
            date: values.date,
            shift: values.shift,
          },
        },
        create: { id: input.id, ...values, createdById: actor.id, updatedById: actor.id },
        update: { ...values, updatedById: actor.id },
        include: attributionInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: existingByDateShift ? 'census.updated' : 'census.created',
          entityType: 'census_record',
          entityId: saved.id,
          before: existingByDateShift ? censusAuditSnapshot(existingByDateShift) : undefined,
          after: censusAuditSnapshot(saved),
        },
      });
      return saved;
    });

    return jsonResponse({
      success: true,
      message: 'บันทึกสำเร็จ',
      record: toCensusRecord(saved),
    });
  } catch (error: unknown) {
    if (isKnownPrismaError(error, 'P2002')) {
      return jsonResponse(
        {
          success: false,
          error: matchedExistingId
            ? 'วันที่และเวรนี้มีรายการอื่นอยู่แล้ว กรุณาตรวจสอบรายการ'
            : 'รหัสรายการหรือคู่วันที่และเวรซ้ำกับข้อมูลอื่น กรุณาตรวจสอบรายการ',
        },
        409
      );
    }

    return jsonResponse(
      { success: false, error: 'ไม่สามารถบันทึกข้อมูลได้ในขณะนี้' },
      503
    );
  }
}
