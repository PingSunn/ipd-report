import { Prisma, Role } from '../generated/prisma/client';
import { prisma } from './prisma';

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type AppRole = 'nurse' | 'ward_head';

export class InvitationAuthorizationError extends Error {
  readonly code = 'forbidden';
  readonly status = 403;

  constructor() {
    super('ต้องใช้สิทธิ์หัวหน้าหอผู้ป่วย');
    this.name = 'InvitationAuthorizationError';
  }
}

async function assertActiveWardHead(tx: Prisma.TransactionClient, actorId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ipd-report-active-ward-heads'))`;
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, active: true },
  });
  if (!actor?.active || actor.role !== Role.ward_head) {
    throw new InvitationAuthorizationError();
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAppRole(value: unknown): value is AppRole {
  return value === 'nurse' || value === 'ward_head';
}

export function roleFromInput(value: AppRole): Role {
  return value === 'ward_head' ? Role.ward_head : Role.nurse;
}

export async function findUsableInvitationForEmail(email: string) {
  return prisma.invitation.findFirst({
    where: {
      email: normalizeEmail(email),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createInvitation(input: {
  email: string;
  role: AppRole;
  createdById: string;
}) {
  const email = normalizeEmail(input.email);
  const role = roleFromInput(input.role);
  const invitation = await prisma.$transaction(async (tx) => {
    await assertActiveWardHead(tx, input.createdById);
    const replaced = await tx.invitation.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.invitation.create({
      data: {
        email,
        role,
        expiresAt: new Date(Date.now() + invitationLifetimeMs),
        createdById: input.createdById,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.createdById,
        action: replaced.count > 0 ? 'invitation.resent' : 'invitation.created',
        entityType: 'invitation',
        entityId: created.id,
        after: { email, role: input.role },
      },
    });
    return created;
  });
  return { invitation };
}

export async function revokeInvitation(id: string, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveWardHead(tx, actorId);
    const result = await tx.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'invitation.revoked',
          entityType: 'invitation',
          entityId: id,
        },
      });
    }
  });
}

export function serializeInvitation(invitation: {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
  };
}

export async function consumeInvitationForOAuth(email: string, userId: string): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: {
        email: normalizedEmail,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!invitation) {
      await tx.user.update({ where: { id: userId }, data: { active: false } });
      return;
    }
    const claimed = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { acceptedAt: new Date(), acceptedById: userId },
    });
    if (claimed.count !== 1) {
      await tx.user.update({ where: { id: userId }, data: { active: false } });
      return;
    }
    await tx.user.update({
      where: { id: userId },
      data: { role: invitation.role, active: true, emailVerified: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'invitation.accepted',
        entityType: 'invitation',
        entityId: invitation.id,
        after: { role: invitation.role },
      },
    });
  });
}
