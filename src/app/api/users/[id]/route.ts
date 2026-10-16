import { z } from 'zod';
import { NextResponse } from 'next/server';
import { authErrorResponse, requireWardHead, updateUserMembership } from '../../../../lib/authorization';
import { isSameOriginMutation } from '../../../../lib/census-validation';
import { isProfileComplete } from '../../../../lib/user-profile';
import { RequestBodyTooLargeError, readBoundedBody } from '../../../../lib/bounded-body';

export const runtime = 'nodejs';
const maxMembershipBodyBytes = 16 * 1024;

const patchSchema = z.object({
  role: z.enum(['nurse', 'ward_head']).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => value.role !== undefined || value.active !== undefined);

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, { status: 403 });
    }
    const actor = await requireWardHead();
    let bodyText: string;
    try {
      bodyText = await readBoundedBody(request, maxMembershipBodyBytes);
    } catch (error: unknown) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ success: false, error: 'คำขอมีขนาดใหญ่เกินไป' }, { status: 413 });
      }
      return NextResponse.json({ success: false, error: 'ข้อมูล role หรือ active ไม่ถูกต้อง' }, { status: 400 });
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return NextResponse.json({ success: false, error: 'ข้อมูล role หรือ active ไม่ถูกต้อง' }, { status: 400 });
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'ข้อมูล role หรือ active ไม่ถูกต้อง' }, { status: 400 });
    }
    const { id } = await context.params;
    const user = await updateUserMembership(actor, id, parsed.data);
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        nickname: user.nickname,
        profileComplete: isProfileComplete(user),
        role: user.role,
        active: user.active,
      },
    });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}
