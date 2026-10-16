import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestBodyTooLargeError, readBoundedBody } from '../src/lib/bounded-body';
import { LINE_CONFIG_LOCK_KEY, LINE_CONFIG_LOCK_OPTIONS } from '../src/lib/line-config-lock';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    appSettings: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    lineWorkerState: { findUnique: vi.fn() },
    verifiedLineGroup: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    lineDelivery: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/authorization', () => ({
  requireUser: vi.fn(async () => ({ id: 'test-user', email: 'test@gmail.com', name: 'Test', role: 'nurse' })),
  requireWardHead: vi.fn(async () => ({ id: 'test-head', email: 'head@gmail.com', name: 'Head', role: 'ward_head' })),
  authErrorResponse: vi.fn(() => Response.json({ success: false }, { status: 401 })),
}));

import { GET as getSettings, PUT as putSettings } from '../src/app/api/settings/route';
import {
  POST as postWebhook,
  isValidLineSignature,
  parseGroupEvents,
} from '../src/app/api/line/webhook/route';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const settingsRecord = {
  id: 'default',
  ...DEFAULT_SETTINGS,
  updatedAt: new Date('2026-10-14T08:00:00.000Z'),
};

function request(method: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/settings', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function signedWebhook(body: string, secret: string): Request {
  const signature = createHmac('sha256', secret).update(body).digest('base64');
  return new Request('http://localhost/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockPrisma.appSettings.findUnique.mockResolvedValue(settingsRecord);
  mockPrisma.appSettings.create.mockResolvedValue(settingsRecord);
  mockPrisma.appSettings.upsert.mockResolvedValue(settingsRecord);
  mockPrisma.lineWorkerState.findUnique.mockResolvedValue(null);
  mockPrisma.verifiedLineGroup.findMany.mockResolvedValue([]);
  mockPrisma.verifiedLineGroup.findUnique.mockResolvedValue(null);
  mockPrisma.appSettings.update.mockResolvedValue(settingsRecord);
  mockPrisma.$executeRaw.mockResolvedValue(0);
  mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  mockPrisma.$transaction.mockImplementation(
    async (callback: (transaction: typeof mockPrisma) => unknown) => callback(mockPrisma)
  );
});

describe('settings API', () => {
  it('returns shared report settings without LINE administration details to nurses', async () => {
    vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'configured-token');
    vi.stubEnv('LINE_CHANNEL_SECRET', 'configured-secret');

    const response = await getSettings();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.settings.hospitalName).toBe('โรงพยาบาลองครักษ์');
    expect(body.settings.defaultCapacity).toBe(30);
    expect(body.settings.lineEnabled).toBe(false);
    expect(body.settings.lineGroupId).toBe('');
    expect(body.groups).toEqual([]);
    expect(body.lineStatus).toEqual({
      accessTokenConfigured: false,
      webhookSecretConfigured: false,
      workerLastSeenAt: null,
    });
    expect(JSON.stringify(body)).not.toContain('configured-token');
    expect(JSON.stringify(body)).not.toContain('configured-secret');
  });

  it('returns Thai field errors and does not persist invalid settings', async () => {
    const response = await putSettings(
      request('PUT', { ...DEFAULT_SETTINGS, defaultCapacity: 0, morningSendTime: '25:99' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.fieldErrors.defaultCapacity).toContain('มากกว่า 0');
    expect(body.fieldErrors.morningSendTime).toContain('รูปแบบ HH:mm');
    expect(mockPrisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('requires same-origin mutation and persists valid settings', async () => {
    const payload = { ...DEFAULT_SETTINGS, defaultCapacity: 32 };
    const foreign = await putSettings(
      request('PUT', payload, {
        origin: 'https://evil.example.org',
        host: '127.0.0.1:3000',
      })
    );
    expect(foreign.status).toBe(403);

    const response = await putSettings(request('PUT', payload));
    expect(response.status).toBe(200);
    expect(mockPrisma.appSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ defaultCapacity: 32 }) })
    );
  });

  it('rejects enabled LINE without a configured token or verified destination', async () => {
    const payload = { ...DEFAULT_SETTINGS, lineEnabled: true, lineGroupId: 'Cunverified' };
    const noToken = await putSettings(request('PUT', payload));
    expect(noToken.status).toBe(400);
    expect((await noToken.json()).fieldErrors.lineEnabled).toContain('token');

    vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'configured-token');
    const noGroup = await putSettings(request('PUT', payload));
    expect(noGroup.status).toBe(400);
    expect((await noGroup.json()).fieldErrors.lineGroupId).toContain('signed webhook');
    expect(mockPrisma.appSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects channel and user IDs as destinations', async () => {
    const channel = await putSettings(
      request('PUT', { ...DEFAULT_SETTINGS, lineGroupId: 'Uuser-123' })
    );
    const channelBody = await channel.json();
    expect(channel.status).toBe(400);
    expect(channelBody.fieldErrors.lineGroupId).toContain('ไม่ถูกต้อง');
  });

  it('rejects ambiguous shift ordering', async () => {
    const response = await putSettings(
      request('PUT', {
        ...DEFAULT_SETTINGS,
        nightSendTime: '08:00',
        morningSendTime: '16:00',
        afternoonSendTime: '12:00',
      })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fieldErrors.afternoonSendTime).toContain('เวรเช้า');
  });
});

describe('LINE webhook', () => {
  it('accepts a signed verification request with no events', async () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', 'configured-secret');
    const body = JSON.stringify({ events: [] });
    const response = await postWebhook(signedWebhook(body, 'configured-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it('rejects forged signatures and unavailable webhook secrets', async () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', 'configured-secret');
    const body = JSON.stringify({ events: [] });
    const forged = await postWebhook(signedWebhook(body, 'wrong-secret'));
    expect(forged.status).toBe(403);

    vi.stubEnv('LINE_CHANNEL_SECRET', '');
    const unavailable = await postWebhook(signedWebhook(body, 'configured-secret'));
    expect(unavailable.status).toBe(503);
  });

  it('stores only bounded group source IDs from a valid signed event', async () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', 'configured-secret');
    mockPrisma.verifiedLineGroup.findUnique.mockResolvedValue({ groupId: 'Cgroup_123' });
    const body = JSON.stringify({
      events: [{ type: 'message', source: { type: 'group', groupId: 'Cgroup_123' } }],
    });
    const response = await postWebhook(signedWebhook(body, 'configured-secret'));

    expect(response.status).toBe(200);
    expect(mockPrisma.verifiedLineGroup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId: 'Cgroup_123' },
        create: expect.objectContaining({ groupId: 'Cgroup_123' }),
      })
    );
    expect(parseGroupEvents({ events: [{ source: { type: 'group', groupId: 'bad id' } }] })).toBe(
      null
    );
  });

  it('revokes a selected group on a signed leave event', async () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', 'configured-secret');
    mockPrisma.appSettings.findUnique.mockResolvedValue({
      ...settingsRecord,
      lineEnabled: true,
      lineGroupId: 'Cleaving',
    });
    const body = JSON.stringify({
      events: [{ type: 'leave', source: { type: 'group', groupId: 'Cleaving' } }],
    });
    const response = await postWebhook(signedWebhook(body, 'configured-secret'));

    expect(response.status).toBe(200);
    expect(mockPrisma.verifiedLineGroup.deleteMany).toHaveBeenCalledWith({
      where: { groupId: { in: ['Cleaving'] } },
    });
    expect(mockPrisma.appSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lineEnabled: false, lineGroupId: '' } })
    );
    expect(mockPrisma.verifiedLineGroup.upsert).not.toHaveBeenCalled();
  });

  it('verifies the exact raw bytes before UTF-8 decoding', async () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', 'configured-secret');
    const bodyBytes = new Uint8Array([...new TextEncoder().encode('{"events":[]}'), 0x80]);
    const signature = createHmac('sha256', 'configured-secret')
      .update(bodyBytes)
      .digest('base64');
    expect(isValidLineSignature(bodyBytes, signature, 'configured-secret')).toBe(true);
    expect(isValidLineSignature(new TextDecoder().decode(bodyBytes), signature, 'configured-secret')).toBe(false);

    const response = await postWebhook(
      new Request('http://localhost/api/line/webhook', {
        method: 'POST',
        headers: { 'x-line-signature': signature },
        body: bodyBytes,
      })
    );
    expect(response.status).toBe(400);
  });
});

describe('bounded request bodies', () => {
  it('stops reading a chunked body as soon as it exceeds the limit', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('0123456789'));
        controller.enqueue(new TextEncoder().encode('overflow'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: stream,
      duplex: 'half',
    });

    await expect(readBoundedBody(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancelled).toBe(true);
  });
});

describe('LINE configuration lock contract', () => {
  it('uses a stable signed key and transaction-safe timeout options', () => {
    expect(LINE_CONFIG_LOCK_KEY).toBe(1_347_291_601);
    expect(LINE_CONFIG_LOCK_KEY).toBeGreaterThanOrEqual(-2_147_483_648);
    expect(LINE_CONFIG_LOCK_KEY).toBeLessThanOrEqual(2_147_483_647);
    expect(LINE_CONFIG_LOCK_OPTIONS).toEqual({ maxWait: 5_000, timeout: 15_000 });
  });
});
