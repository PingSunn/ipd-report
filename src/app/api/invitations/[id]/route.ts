import { NextResponse } from 'next/server';
import { authErrorResponse, requireWardHead } from '../../../../lib/authorization';
import { createInvitation, revokeInvitation, serializeInvitation } from '../../../../lib/invitations';
import { isSameOriginMutation } from '../../../../lib/census-validation';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, { status: 403 });
    }
    const actor = await requireWardHead();
    const { id } = await context.params;
    const existing = await prisma.invitation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'ไม่พบคำเชิญ' }, { status: 404 });
    }
    const result = await createInvitation({
      email: existing.email,
      role: existing.role === 'ward_head' ? 'ward_head' : 'nurse',
      createdById: actor.id,
    });
    return NextResponse.json({ success: true, invitation: serializeInvitation(result.invitation) });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, { status: 403 });
    }
    const actor = await requireWardHead();
    const { id } = await context.params;
    await revokeInvitation(id, actor.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}
