import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../src/generated/prisma/client';

import { isSameOriginMutation } from '../src/lib/census-validation';
import { safeCallbackUrl } from '../src/lib/redirect';
import { withBoundedRequestBody } from '../src/lib/bounded-body';

const { mockPrisma, tx } = vi.hoisted(() => ({
  mockPrisma: { $transaction: vi.fn() },
  tx: {
    $executeRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    invitation: { updateMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma', () => ({ prisma: mockPrisma }));

import { createInvitation, revokeInvitation } from '../src/lib/invitations';

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx));
});

function mutation(headers: Record<string, string> = {}): Request {
  return new Request('https://internal.service/api/mutation', {
    method: 'POST',
    headers,
  });
}

describe('cookie mutation origin policy', () => {
  it('rejects cookie-authenticated mutations without an Origin header', () => {
    expect(isSameOriginMutation(mutation({ cookie: 'better-auth.session_token=secret' }))).toBe(false);
  });

  it('accepts a canonical configured origin even when the proxy host is internal', () => {
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://ipd.example.test/app');
    expect(isSameOriginMutation(mutation({
      origin: 'https://ipd.example.test',
      cookie: 'better-auth.session_token=secret',
      host: 'internal.service',
      'x-forwarded-proto': 'https',
    }))).toBe(true);
  });

  it('rejects cross-site fetch metadata when Origin is absent', () => {
    expect(isSameOriginMutation(mutation({
      cookie: 'better-auth.session_token=secret',
      'sec-fetch-site': 'cross-site',
    }))).toBe(false);
  });
});

describe('login callback validation', () => {
  it.each([
    ['//evil.example.test', '/'],
    ['/\\evil.example.test', '/'],
    ['https://evil.example.test', '/'],
    [null, '/'],
  ])('rejects unsafe callback %s', (value, expected) => {
    expect(safeCallbackUrl(value)).toBe(expected);
  });

  it('keeps an application-relative callback path', () => {
    expect(safeCallbackUrl('/history?date=2026-10-16')).toBe('/history?date=2026-10-16');
  });
});

describe('bounded authentication request bodies', () => {
  it('rejects an oversized streaming body before invoking the auth handler', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const guarded = withBoundedRequestBody(handler, 8);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.enqueue(new TextEncoder().encode('67890'));
        controller.close();
      },
    });
    const request = new Request('https://ipd.example.test/api/auth/sign-in/social', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const response = await guarded(request);

    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('replays an accepted body exactly once to the auth handler', async () => {
    const handler = vi.fn(async (request: Request) => Response.json({ body: await request.text() }));
    const guarded = withBoundedRequestBody(handler, 64);
    const request = new Request('https://ipd.example.test/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"provider":"google"}',
    });

    const response = await guarded(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ body: '{"provider":"google"}' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('invitation transaction authorization', () => {
  it('rechecks ward-head status before creating or replacing an invitation', async () => {
    tx.user.findUnique.mockResolvedValue({ role: Role.nurse, active: true });

    await expect(createInvitation({
      email: 'nurse@gmail.com',
      role: 'nurse',
      createdById: 'actor',
    })).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.invitation.updateMany).not.toHaveBeenCalled();
    expect(tx.invitation.create).not.toHaveBeenCalled();
  });

  it('rechecks ward-head status before revocation', async () => {
    tx.user.findUnique.mockResolvedValue({ role: Role.ward_head, active: false });

    await expect(revokeInvitation('invitation-1', 'actor')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });

    expect(tx.invitation.updateMany).not.toHaveBeenCalled();
  });
});
