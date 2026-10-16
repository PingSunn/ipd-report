import { z } from 'zod';
import { NextResponse } from 'next/server';
import { authErrorResponse, requireWardHead } from '../../../lib/authorization';
import { createInvitation, normalizeEmail, serializeInvitation } from '../../../lib/invitations';
import { isSameOriginMutation } from '../../../lib/census-validation';
import { prisma } from '../../../lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  email: z.string().trim().email().max(320).refine(
    (email) => normalizeEmail(email).endsWith('@gmail.com'),
    'ต้องใช้อีเมล @gmail.com',
  ),
  role: z.enum(['nurse', 'ward_head']).default('nurse'),
}).strict();

export async function GET(): Promise<Response> {
  try {
    await requireWardHead();
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ success: true, invitations: invitations.map(serializeInvitation) });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ success: false, error: 'คำขอจากต้นทางไม่ถูกต้อง' }, { status: 403 });
    }
    const actor = await requireWardHead();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'กรุณาระบุ Gmail และ role ที่ถูกต้อง' }, { status: 400 });
    }
    const email = normalizeEmail(parsed.data.email);
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'อีเมลนี้เป็นผู้ใช้งานในระบบแล้ว กรุณาเปลี่ยนสถานะจากรายชื่อผู้ใช้' },
        { status: 409 },
      );
    }
    const result = await createInvitation({ ...parsed.data, email, createdById: actor.id });
    return NextResponse.json({ success: true, invitation: serializeInvitation(result.invitation) }, { status: 201 });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}
