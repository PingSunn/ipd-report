import { NextResponse } from 'next/server';
import type { LineDeliveryStatus } from '../../../../types/settings';
import { prisma } from '../../../../lib/prisma';
import { authErrorResponse, requireWardHead } from '../../../../lib/authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function deliveryStatus(value: string): LineDeliveryStatus {
  if (
    value === 'PENDING' ||
    value === 'PROCESSING' ||
    value === 'ACCEPTED' ||
    value === 'FAILED' ||
    value === 'SKIPPED'
  ) {
    return value;
  }
  return 'FAILED';
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireWardHead();
  } catch (error: unknown) {
    return authErrorResponse(error) as NextResponse;
  }
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return jsonResponse({ success: false, error: 'จำนวนรายการไม่ถูกต้อง' }, 400);
  }

  try {
    const deliveries = await prisma.lineDelivery.findMany({
      orderBy: [{ reportDate: 'desc' }, { scheduledAt: 'desc' }],
      take: limit,
    });

    return jsonResponse({
      success: true,
      history: deliveries.map((delivery) => ({
        id: delivery.id,
        reportDate: delivery.reportDate.toISOString().slice(0, 10),
        shift: delivery.shift,
        scheduledAt: delivery.scheduledAt.toISOString(),
        kind: delivery.kind === 'MISSING' ? 'MISSING' : 'REPORT',
        status: deliveryStatus(delivery.status),
        groupId: delivery.groupId,
        attempts: delivery.attempts,
        firstAttemptAt: delivery.firstAttemptAt?.toISOString() ?? null,
        nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
        acceptedAt: delivery.acceptedAt?.toISOString() ?? null,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt.toISOString(),
        updatedAt: delivery.updatedAt.toISOString(),
      })),
    });
  } catch {
    return jsonResponse(
      { success: false, history: [], error: 'ไม่สามารถโหลดประวัติ LINE ได้ในขณะนี้' },
      503
    );
  }
}
