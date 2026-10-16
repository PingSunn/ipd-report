import { NextResponse } from 'next/server';
import { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../lib/prisma';
import { RequestBodyTooLargeError, readBoundedBody } from '../../../lib/bounded-body';
import { withLineConfigLock } from '../../../lib/line-config-lock';
import {
  getAppSettings,
  getLineWorkerState,
  getVerifiedLineGroups,
  isLineAccessTokenConfigured,
  lineStatus,
  toSettingsDto,
  toVerifiedLineGroupDto,
} from '../../../lib/settings';
import { parseSettingsUpdate, validateScheduleTimes } from '../../../lib/settings-validation';
import { isSameOriginMutation } from '../../../lib/census-validation';
import { authErrorResponse, requireUser, requireWardHead, type AuthenticatedUser } from '../../../lib/authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };
const maxSettingsBodyBytes = 64 * 1024;

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function GET(): Promise<NextResponse> {
  let actor: AuthenticatedUser;
  try {
    actor = await requireUser();
  } catch (error: unknown) {
    return authErrorResponse(error) as NextResponse;
  }
  try {
    const [settings, workerState, groups] = await Promise.all([
      getAppSettings(),
      getLineWorkerState(),
      getVerifiedLineGroups(),
    ]);

    const settingsDto = toSettingsDto(settings);
    if (actor.role !== 'ward_head') {
      return jsonResponse({
        success: true,
        settings: { ...settingsDto, lineEnabled: false, lineGroupId: '' },
        lineStatus: {
          accessTokenConfigured: false,
          webhookSecretConfigured: false,
          workerLastSeenAt: null,
        },
        groups: [],
      });
    }

    return jsonResponse({
      success: true,
      settings: toSettingsDto(settings),
      lineStatus: lineStatus(workerState),
      groups: groups.map(toVerifiedLineGroupDto),
    });
  } catch {
    return jsonResponse(
      { success: false, error: 'ไม่สามารถโหลดการตั้งค่าได้ในขณะนี้' },
      503
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  let actor: AuthenticatedUser;
  try {
    actor = await requireWardHead();
  } catch (error: unknown) {
    return authErrorResponse(error) as NextResponse;
  }
  if (!isSameOriginMutation(request)) {
    return jsonResponse({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, 403);
  }

  let bodyText: string;
  try {
    bodyText = await readBoundedBody(request, maxSettingsBodyBytes);
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse({ success: false, error: 'คำขอมีขนาดใหญ่เกินไป' }, 413);
    }
    return jsonResponse(
      { success: false, error: 'ข้อมูลการตั้งค่าไม่ถูกต้อง กรุณาตรวจสอบรายการที่แจ้ง' },
      400
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return jsonResponse(
      {
        success: false,
        error: 'ข้อมูลการตั้งค่าไม่ถูกต้อง กรุณาตรวจสอบรายการที่แจ้ง',
      },
      400
    );
  }

  const parsed = parseSettingsUpdate(body);
  if (!parsed.success) {
    return jsonResponse(
      { success: false, error: parsed.message, fieldErrors: parsed.fieldErrors },
      400
    );
  }

  const scheduleErrors = validateScheduleTimes(parsed.data);
  if (Object.keys(scheduleErrors).length > 0) {
    return jsonResponse(
      {
        success: false,
        error: 'เวลาการส่ง LINE ไม่ถูกต้อง กรุณาตรวจสอบลำดับเวลา',
        fieldErrors: scheduleErrors,
      },
      400
    );
  }

  if (parsed.data.lineEnabled && !isLineAccessTokenConfigured()) {
    return jsonResponse(
      {
        success: false,
        error: 'ยังไม่สามารถเปิดการส่ง LINE ได้ เนื่องจากยังไม่มี Channel access token',
        fieldErrors: { lineEnabled: 'ยังไม่มี Channel access token' },
      },
      400
    );
  }
  if (parsed.data.lineEnabled && !parsed.data.lineGroupId) {
    return jsonResponse(
      {
        success: false,
        error: 'ยังไม่สามารถเปิดการส่ง LINE ได้ เนื่องจากยังไม่มี Group ID',
        fieldErrors: { lineGroupId: 'กรุณาเลือก Group ID ที่ผ่าน signed webhook แล้ว' },
      },
      400
    );
  }

  try {
    const result = await withLineConfigLock(prisma, async (transaction) => {
      // The session check above can become stale while waiting for the LINE
      // configuration lock. Re-read the actor under the same transaction that
      // writes the privileged setting.
      const currentActor = await transaction.user.findUnique({
        where: { id: actor.id },
        select: { active: true, role: true },
      });
      if (!currentActor?.active || currentActor.role !== 'ward_head') {
        return { ok: false as const, authorizationFailed: true as const };
      }
      if (parsed.data.lineEnabled) {
        const verifiedGroup = await transaction.verifiedLineGroup.findUnique({
          where: { groupId: parsed.data.lineGroupId },
        });
        if (!verifiedGroup) {
          return {
            ok: false as const,
            fieldErrors: { lineGroupId: 'กรุณาเลือก Group ID ที่ผ่าน signed webhook แล้ว' },
          };
        }
      }

      const previous = await transaction.appSettings.findUnique({ where: { id: 'default' } });
      const settings = await transaction.appSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', ...parsed.data, updatedById: actor.id },
        update: { ...parsed.data, updatedById: actor.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'settings.updated',
          entityType: 'app_settings',
          entityId: settings.id,
          before: {
            previous: previous ? toSettingsDto(previous) : null,
          } as unknown as Prisma.InputJsonObject,
          after: {
            next: toSettingsDto(settings),
          } as unknown as Prisma.InputJsonObject,
        },
      });
      return { ok: true as const, settings };
    });
    if ('authorizationFailed' in result) {
      return jsonResponse({ success: false, error: 'ต้องใช้สิทธิ์หัวหน้าหอผู้ป่วย' }, 403);
    }
    if (!result.ok) {
      return jsonResponse(
        {
          success: false,
          error: 'ยังไม่สามารถเปิดการส่ง LINE ได้ เนื่องจาก Group ID ยังไม่ผ่านการยืนยัน',
          fieldErrors: result.fieldErrors,
        },
        400
      );
    }
    return jsonResponse({ success: true, settings: toSettingsDto(result.settings) });
  } catch (error: unknown) {
    return jsonResponse(
      { success: false, error: 'ไม่สามารถบันทึกการตั้งค่าได้ในขณะนี้' },
      503
    );
  }
}
