import { headers } from 'next/headers';
import { Role } from '../generated/prisma/client';
import { auth } from './auth';
import { prisma } from './prisma';
import type { AppRole } from './invitations';
import { isProfileComplete } from './user-profile';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  profileComplete: boolean;
  role: AppRole;
};

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ success: false, error: error.message, code: error.code }, { status: error.status });
  }
  console.error(error);
  return Response.json({ success: false, error: 'ไม่สามารถดำเนินการได้ในขณะนี้' }, { status: 500 });
}

export async function requireUser(options: { allowIncompleteProfile?: boolean } = {}): Promise<AuthenticatedUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    throw new AuthError('unauthenticated', 'กรุณาเข้าสู่ระบบก่อนใช้งาน', 401);
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.active) {
    throw new AuthError('inactive_account', 'บัญชีนี้ถูกระงับการใช้งาน', 403);
  }
  if (user.role !== Role.nurse && user.role !== Role.ward_head) {
    throw new AuthError('invalid_role', 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน', 403);
  }
  const authenticatedUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    nickname: user.nickname,
    profileComplete: isProfileComplete(user),
    role: user.role,
  };
  if (!options.allowIncompleteProfile && !authenticatedUser.profileComplete) {
    throw new AuthError('profile_incomplete', 'กรุณาตั้งค่าโปรไฟล์ก่อนใช้งานระบบ', 403);
  }
  return authenticatedUser;
}

export async function requireWardHead(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (user.role !== 'ward_head') {
    throw new AuthError('forbidden', 'ต้องใช้สิทธิ์หัวหน้าหอผู้ป่วย', 403);
  }
  return user;
}

export type MembershipPatch = { role?: AppRole; active?: boolean };

export async function updateUserMembership(
  actor: AuthenticatedUser,
  userId: string,
  patch: MembershipPatch,
) {
  if (actor.role !== 'ward_head') {
    throw new AuthError('forbidden', 'ต้องใช้สิทธิ์หัวหน้าหอผู้ป่วย', 403);
  }
  if (patch.role === undefined && patch.active === undefined) {
    throw new AuthError('invalid_patch', 'ต้องระบุ role หรือ active', 400);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ipd-report-active-ward-heads'))`;
    const currentActor = await tx.user.findUnique({
      where: { id: actor.id },
      select: { role: true, active: true },
    });
    if (!currentActor || !currentActor.active || currentActor.role !== Role.ward_head) {
      throw new AuthError('forbidden', 'ต้องใช้สิทธิ์หัวหน้าหอผู้ป่วย', 403);
    }
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new AuthError('not_found', 'ไม่พบผู้ใช้งาน', 404);

    const nextRole = patch.role === undefined ? target.role : roleFromAppRole(patch.role);
    const nextActive = patch.active === undefined ? target.active : patch.active;
    if (
      target.role === Role.ward_head &&
      target.active &&
      (nextRole !== Role.ward_head || !nextActive)
    ) {
      const activeWardHeads = await tx.user.count({ where: { role: Role.ward_head, active: true } });
      if (activeWardHeads <= 1) {
        throw new AuthError('last_ward_head', 'หัวหน้าหอผู้ป่วยที่ใช้งานอยู่คนสุดท้ายห้ามถูกลดสิทธิ์หรือปิดใช้งาน', 409);
      }
    }

    const user = await tx.user.update({
      where: { id: userId },
      data: { role: nextRole, active: nextActive },
    });
    if (!nextActive) {
      await tx.session.deleteMany({ where: { userId } });
      await tx.invitation.updateMany({
        where: { email: target.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (patch.role !== undefined && nextRole !== target.role) {
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.role.updated',
          entityType: 'user',
          entityId: user.id,
          before: { role: target.role },
          after: { role: nextRole },
        },
      });
    }
    if (patch.active !== undefined && nextActive !== target.active) {
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.status.updated',
          entityType: 'user',
          entityId: user.id,
          before: { active: target.active },
          after: { active: nextActive },
        },
      });
    }
    return user;
  });
}

function roleFromAppRole(role: AppRole): Role {
  return role === 'ward_head' ? Role.ward_head : Role.nurse;
}
