import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession, mockFindUnique } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('../src/lib/auth', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('../src/lib/prisma', () => ({ prisma: { user: { findUnique: mockFindUnique } } }));

import { AuthError, requireUser } from '../src/lib/authorization';

const baseUser = {
  id: 'user-1',
  email: 'nurse@gmail.com',
  name: 'Pongsakorn Wera',
  firstName: null,
  lastName: null,
  nickname: null,
  active: true,
  role: 'nurse' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: baseUser.id } });
  mockFindUnique.mockResolvedValue(baseUser);
});

describe('profile completion authorization', () => {
  it('blocks incomplete users from protected application APIs', async () => {
    await expect(requireUser()).rejects.toMatchObject<AuthError>({
      code: 'profile_incomplete',
      status: 403,
    });
  });

  it('allows the profile endpoint to authenticate an incomplete user', async () => {
    const user = await requireUser({ allowIncompleteProfile: true });
    expect(user).toMatchObject({ id: baseUser.id, profileComplete: false });
  });

  it('allows a complete active user through the normal guard', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseUser,
      firstName: 'พงศกร',
      lastName: 'วีระ',
      nickname: 'กร',
    });
    const user = await requireUser();
    expect(user.profileComplete).toBe(true);
  });
});
