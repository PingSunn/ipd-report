import { NextResponse } from 'next/server';
import { authErrorResponse, requireUser } from '../../../lib/authorization';
import { RequestBodyTooLargeError, readBoundedBody } from '../../../lib/bounded-body';
import { isSameOriginMutation } from '../../../lib/census-validation';
import { prisma } from '../../../lib/prisma';
import { profileSchema, serializeUserProfile } from '../../../lib/user-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxProfileBodyBytes = 16 * 1024;

export async function GET(): Promise<Response> {
  try {
    const actor = await requireUser({ allowIncompleteProfile: true });
    return NextResponse.json({
      success: true,
      profile: serializeUserProfile(actor),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, { status: 403 });
    }
    const actor = await requireUser({ allowIncompleteProfile: true });
    let bodyText: string;
    try {
      bodyText = await readBoundedBody(request, maxProfileBodyBytes);
    } catch (error: unknown) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ success: false, error: 'คำขอมีขนาดใหญ่เกินไป' }, { status: 413 });
      }
      return NextResponse.json({ success: false, error: 'ข้อมูลโปรไฟล์ไม่ถูกต้อง' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return NextResponse.json({ success: false, error: 'ข้อมูลโปรไฟล์ไม่ถูกต้อง' }, { status: 400 });
    }
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: 'กรุณากรอกชื่อจริง นามสกุล และชื่อเล่นให้ครบถ้วน',
        fieldErrors: parsed.error.flatten().fieldErrors,
      }, { status: 400 });
    }

    const profile = parsed.data;
    const user = await prisma.user.update({
      where: { id: actor.id },
      data: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        nickname: profile.nickname,
        name: `${profile.firstName} ${profile.lastName}`,
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        nickname: true,
      },
    });

    return NextResponse.json({
      success: true,
      profile: serializeUserProfile(user),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}
