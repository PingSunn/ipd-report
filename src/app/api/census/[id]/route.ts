import { NextResponse } from 'next/server';
import { Prisma } from '../../../../generated/prisma/client';
import { prisma } from '../../../../lib/prisma';
import { isSameOriginMutation } from '../../../../lib/census-validation';
import { authErrorResponse, requireWardHead, type AuthenticatedUser } from '../../../../lib/authorization';

export const runtime = 'nodejs';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function censusAuditSnapshot(record: {
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
  lineNote: string;
}): Prisma.InputJsonObject {
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
    lineNote: record.lineNote,
  };
}

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function isKnownPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  let actor: AuthenticatedUser;
  try {
    actor = await requireWardHead();
  } catch (error: unknown) {
    return authErrorResponse(error) as NextResponse;
  }
  if (!isSameOriginMutation(request)) {
    return jsonResponse({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, 403);
  }

  const { id } = await context.params;
  if (!id || id.length > 128) {
    return jsonResponse({ success: false, error: 'รหัสรายการไม่ถูกต้อง' }, 400);
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const deleted = await transaction.censusRecord.delete({ where: { id } });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'census.deleted',
          entityType: 'census_record',
          entityId: id,
          before: censusAuditSnapshot(deleted),
        },
      });
    });
    return jsonResponse({ success: true });
  } catch (error: unknown) {
    if (isKnownPrismaError(error, 'P2025')) {
      return jsonResponse({ success: false, error: 'ไม่พบรายการที่ต้องการลบ' }, 404);
    }

    return jsonResponse(
      { success: false, error: 'ไม่สามารถลบข้อมูลได้ในขณะนี้' },
      503
    );
  }
}
