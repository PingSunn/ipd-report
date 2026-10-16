import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, mockRequireUser, mockAuthErrorResponse } = vi.hoisted(() => ({
  mockPrisma: { user: { update: vi.fn() } },
  mockRequireUser: vi.fn(),
  mockAuthErrorResponse: vi.fn((error: unknown) => Response.json({ success: false, error }, { status: 500 })),
}));

vi.mock('../src/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/authorization', () => ({
  requireUser: mockRequireUser,
  authErrorResponse: mockAuthErrorResponse,
}));

import { GET, PATCH } from '../src/app/api/profile/route';
import { splitGoogleName } from '../src/lib/user-profile';

const actor = {
  id: 'user-1',
  email: 'nurse@gmail.com',
  name: 'Pongsakorn Wera',
  firstName: null,
  lastName: null,
  nickname: null,
  profileComplete: false,
  role: 'nurse' as const,
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue(actor);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('profile API', () => {
  it('suggests a safe first/last name split from Google display names', () => {
    expect(splitGoogleName('Pongsakorn Wera')).toEqual({ firstName: 'Pongsakorn', lastName: 'Wera' });
    expect(splitGoogleName('  พงศกร  วีระ  สุขใจ ')).toEqual({ firstName: 'พงศกร', lastName: 'วีระ สุขใจ' });
    expect(splitGoogleName('SingleName')).toEqual({ firstName: 'SingleName', lastName: null });
    expect(splitGoogleName('   ')).toEqual({ firstName: null, lastName: null });
  });

  it('returns profile completion state and Google name suggestions', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({
      email: 'nurse@gmail.com',
      profileComplete: false,
      suggestedFirstName: 'Pongsakorn',
      suggestedLastName: 'Wera',
    });
  });

  it('rejects incomplete or unknown profile fields', async () => {
    const response = await PATCH(request({ firstName: 'พงศกร', lastName: 'วีระ', extra: 'unexpected' }));
    expect(response.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a nickname longer than the UI limit', async () => {
    const response = await PATCH(request({ firstName: 'พงศกร', lastName: 'วีระ', nickname: 'ก'.repeat(51) }));
    expect(response.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects invisible Unicode profile values', async () => {
    const response = await PATCH(request({ firstName: '\u200B', lastName: 'วีระ', nickname: 'กร' }));
    expect(response.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('updates only the authenticated user with a complete profile', async () => {
    mockPrisma.user.update.mockResolvedValue({
      id: actor.id,
      email: actor.email,
      name: 'พงศกร วีระ',
      firstName: 'พงศกร',
      lastName: 'วีระ',
      nickname: 'กร',
    });
    const response = await PATCH(request({ firstName: ' พงศกร ', lastName: 'วีระ', nickname: 'กร' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: { firstName: 'พงศกร', lastName: 'วีระ', nickname: 'กร', name: 'พงศกร วีระ' },
      select: expect.any(Object),
    });
    expect(body.profile).toMatchObject({
      firstName: 'พงศกร',
      lastName: 'วีระ',
      nickname: 'กร',
      profileComplete: true,
    });
  });

  it('accepts a configured public origin when the reverse proxy exposes an internal host', async () => {
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://ipd.pskwr.com');
    mockPrisma.user.update.mockResolvedValue({
      id: actor.id,
      email: actor.email,
      name: 'พงศกร วีระ',
      firstName: 'พงศกร',
      lastName: 'วีระ',
      nickname: 'กร',
    });

    const response = await PATCH(request(
      { firstName: 'พงศกร', lastName: 'วีระ', nickname: 'กร' },
      {
        origin: 'https://ipd.pskwr.com',
        host: 'ipd-report.ipd-report.svc.cluster.local',
        'x-forwarded-proto': 'https',
      },
    ));

    expect(response.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('rejects a foreign origin when the proxy exposes an internal host', async () => {
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://ipd.pskwr.com');

    const response = await PATCH(request(
      { firstName: 'พงศกร', lastName: 'วีระ', nickname: 'กร' },
      {
        origin: 'https://evil.example.org',
        host: 'ipd-report.ipd-report.svc.cluster.local',
        'x-forwarded-proto': 'https',
      },
    ));

    expect(response.status).toBe(403);
    expect(mockRequireUser).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects cross-origin profile updates', async () => {
    const response = await PATCH(request(
      { firstName: 'พงศกร', lastName: 'วีระ', nickname: 'กร' },
      { origin: 'https://evil.example.org', host: 'localhost' },
    ));
    expect(response.status).toBe(403);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });
});
