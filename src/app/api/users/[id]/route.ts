import { z } from 'zod';
import { NextResponse } from 'next/server';
import { authErrorResponse, requireWardHead, updateUserMembership } from '../../../../lib/authorization';
import { isSameOriginMutation } from '../../../../lib/census-validation';
import { isProfileComplete } from '../../../../lib/user-profile';

export const runtime = 'nodejs';

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
    const parsed = patchSchema.safeParse(await request.json());
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
