import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../src/generated/prisma/client';

const { mockPrisma, tx } = vi.hoisted(() => ({
  mockPrisma: { $transaction: vi.fn() },
  tx: {
    $executeRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    session: { deleteMany: vi.fn() },
    invitation: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../src/lib/auth', () => ({ auth: {} }));
vi.mock('../src/lib/prisma', () => ({ prisma: mockPrisma }));

import { updateUserMembership } from '../src/lib/authorization';

describe('ward-head membership policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx));
    tx.user.findUnique
      .mockResolvedValueOnce({ role: Role.ward_head, active: true })
      .mockResolvedValueOnce({
        id: 'target',
        email: 'target@gmail.com',
        role: Role.ward_head,
        active: true,
      });
  });

  it('preserves the last active ward head', async () => {
    tx.user.count.mockResolvedValue(1);
    const actor = { id: 'actor', email: 'actor@gmail.com', name: 'Actor', role: 'ward_head' as const };

    await expect(updateUserMembership(actor, 'target', { active: false })).rejects.toMatchObject({
      code: 'last_ward_head',
      status: 409,
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('audits a role change and revokes sessions on deactivation', async () => {
    tx.user.count.mockResolvedValue(2);
    tx.user.update.mockResolvedValue({
      id: 'target',
      email: 'target@gmail.com',
      name: 'Target',
      role: Role.nurse,
      active: false,
    });
    const actor = { id: 'actor', email: 'actor@gmail.com', name: 'Actor', role: 'ward_head' as const };

    await updateUserMembership(actor, 'target', { role: 'nurse', active: false });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'target' },
      data: { role: Role.nurse, active: false },
    });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
  });
});
