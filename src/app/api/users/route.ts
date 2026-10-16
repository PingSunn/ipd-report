import { NextResponse } from 'next/server';
import { authErrorResponse, requireWardHead } from '../../../lib/authorization';
import { prisma } from '../../../lib/prisma';
import { isProfileComplete } from '../../../lib/user-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireWardHead();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        firstName: true,
        lastName: true,
        nickname: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return NextResponse.json({
      success: true,
      users: users.map((user) => ({
        ...user,
        profileComplete: isProfileComplete(user),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    return authErrorResponse(error);
  }
}
