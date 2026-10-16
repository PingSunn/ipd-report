import { z } from 'zod';
import { NextResponse } from 'next/server';
import { authErrorResponse, requireWardHead } from '../../../lib/authorization';
import {
  createInvitation,
  InvitationAuthorizationError,
  normalizeEmail,
  serializeInvitation,
} from '../../../lib/invitations';
import { RequestBodyTooLargeError, readBoundedBody } from '../../../lib/bounded-body';
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
const maxInvitationBodyBytes = 16 * 1024;

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
    let bodyText: string;
    try {
      bodyText = await readBoundedBody(request, maxInvitationBodyBytes);
    } catch (error: unknown) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ success: false, error: 'คำขอมีขนาดใหญ่เกินไป' }, { status: 413 });
      }
      return NextResponse.json({ success: false, error: 'ข้อมูลคำเชิญไม่ถูกต้อง' }, { status: 400 });
    }
    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return NextResponse.json({ success: false, error: 'ข้อมูลคำเชิญไม่ถูกต้อง' }, { status: 400 });
    }
    const parsed = createSchema.safeParse(body);
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
    if (error instanceof InvitationAuthorizationError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}
