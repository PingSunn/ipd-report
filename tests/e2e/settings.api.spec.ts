import { expect, test, type APIRequestContext } from '@playwright/test';

type ReportFormat = 'standard' | 'compact' | 'detailed';

type SettingsInput = {
  hospitalName: string;
  wardName: string;
  defaultCapacity: number;
  reportFormat: ReportFormat;
  includeCapacityAndOccupancy: boolean;
  includeCategories: boolean;
  includeWorkloadHours: boolean;
  includeNote: boolean;
  lineEnabled: boolean;
  lineGroupId: string;
  nightSendTime: string;
  morningSendTime: string;
  afternoonSendTime: string;
};

type SettingsDto = SettingsInput & {
  id: 'default';
  timezone?: 'Asia/Bangkok';
  updatedAt: string;
};

type SettingsResponse = {
  success: true;
  settings: SettingsDto;
  lineStatus: {
    accessTokenConfigured: boolean;
    webhookSecretConfigured: boolean;
    workerLastSeenAt: string | null;
  };
  groups: Array<{ groupId: string; firstSeen: string; lastSeen: string }>;
};

type ErrorResponse = {
  success: false;
  error: string;
  fieldErrors?: Record<string, string>;
};

const qaSettings: SettingsInput = {
  hospitalName: `QA Hospital ${Date.now()}`,
  wardName: 'QA IPD Ward',
  defaultCapacity: 47,
  reportFormat: 'detailed',
  includeCapacityAndOccupancy: false,
  includeCategories: false,
  includeWorkloadHours: false,
  includeNote: false,
  lineEnabled: false,
  lineGroupId: 'Cqa_group-2026',
  nightSendTime: '07:15',
  morningSendTime: '15:45',
  afternoonSendTime: '23:30',
};

async function getSettings(request: APIRequestContext): Promise<SettingsResponse> {
  const response = await request.get('/api/settings');
  expect(response.status(), 'settings GET should be available').toBe(200);
  const body = (await response.json()) as SettingsResponse;
  expect(body.success).toBe(true);
  return body;
}

async function putSettings(
  request: APIRequestContext,
  input: SettingsInput,
): Promise<SettingsResponse> {
  const response = await request.put('/api/settings', {
    data: input,
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { success: true; settings: SettingsDto };
  expect(body.success).toBe(true);
  return {
    success: true,
    settings: body.settings,
    lineStatus: {
      accessTokenConfigured: false,
      webhookSecretConfigured: false,
      workerLastSeenAt: null,
    },
    groups: [],
  };
}

function settingsInput(settings: SettingsDto): SettingsInput {
  return {
    hospitalName: settings.hospitalName,
    wardName: settings.wardName,
    defaultCapacity: settings.defaultCapacity,
    reportFormat: settings.reportFormat,
    includeCapacityAndOccupancy: settings.includeCapacityAndOccupancy,
    includeCategories: settings.includeCategories,
    includeWorkloadHours: settings.includeWorkloadHours,
    includeNote: settings.includeNote,
    lineEnabled: settings.lineEnabled,
    lineGroupId: settings.lineGroupId,
    nightSendTime: settings.nightSendTime,
    morningSendTime: settings.morningSendTime,
    afternoonSendTime: settings.afternoonSendTime,
  };
}

function collectObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (typeof value !== 'object' || value === null) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(child, keys);
  }
  return keys;
}

const forbiddenSecretKeys = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'lineChannelAccessToken',
  'lineChannelSecret',
  'channelAccessToken',
  'channelSecret',
  'accessToken',
  'secret',
  'token',
];

test.describe('live settings and LINE API', () => {
  test('returns shared settings and redacted LINE readiness', async ({ request }) => {
    const response = await request.get('/api/settings');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as SettingsResponse;
    expect(body.success).toBe(true);
    expect(body.settings.id).toBe('default');
    expect(body.settings.lineEnabled, 'scheduled LINE must remain disabled in QA').toBe(false);
    expect(body.settings.timezone).toBe('Asia/Bangkok');

    const keys = collectObjectKeys(body);
    for (const key of forbiddenSecretKeys) expect(keys.has(key)).toBe(false);
    expect(keys.has('accessTokenConfigured')).toBe(true);
    expect(keys.has('webhookSecretConfigured')).toBe(true);

    const history = await request.get('/api/line/history?limit=1');
    expect(history.status()).toBe(200);
    const historyBody = (await history.json()) as Record<string, unknown>;
    for (const key of forbiddenSecretKeys) expect(collectObjectKeys(historyBody).has(key)).toBe(false);
  });

  test('persists every shared setting, reloads it, and restores the original input', async ({ request }) => {
    const original = await getSettings(request);
    expect(original.settings.lineEnabled, 'test must start with LINE disabled').toBe(false);

    try {
      await putSettings(request, qaSettings);
      const reloaded = await getSettings(request);
      expect(reloaded.settings).toMatchObject(qaSettings);
      expect(reloaded.settings.lineEnabled).toBe(false);
      expect(reloaded.settings.timezone).toBe('Asia/Bangkok');
    } finally {
      await putSettings(request, settingsInput(original.settings));
      const restored = await getSettings(request);
      expect(restored.settings).toMatchObject(settingsInput(original.settings));
      expect(restored.settings.lineEnabled).toBe(false);
    }
  });

  test('rejects invalid capacity, time, and group values without persistence', async ({ request }) => {
    const original = await getSettings(request);
    const invalid = { ...settingsInput(original.settings), defaultCapacity: 0, morningSendTime: '25:99', lineGroupId: 'Xgroup_123' };
    const response = await request.put('/api/settings', {
      data: invalid,
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.fieldErrors?.defaultCapacity).toContain('มากกว่า 0');
    expect(body.fieldErrors?.morningSendTime).toContain('รูปแบบ HH:mm');
    expect(body.fieldErrors?.lineGroupId).toContain('ไม่ถูกต้อง');

    const invalidSchedule = {
      ...settingsInput(original.settings),
      nightSendTime: '16:00',
      morningSendTime: '08:00',
      afternoonSendTime: '00:00',
    };
    const scheduleResponse = await request.put('/api/settings', {
      data: invalidSchedule,
      headers: { 'content-type': 'application/json' },
    });
    expect(scheduleResponse.status()).toBe(400);
    const scheduleBody = (await scheduleResponse.json()) as ErrorResponse;
    expect(scheduleBody.error).toContain('ลำดับเวลา');
    expect(scheduleBody.fieldErrors?.nightSendTime).toContain('ก่อนเวรเช้า');
    expect(scheduleBody.fieldErrors?.morningSendTime).toContain('หลังเวรดึก');

    const after = await getSettings(request);
    expect(after.settings).toMatchObject(settingsInput(original.settings));
  });

  test('rejects unsigned and forged LINE webhook requests', async ({ request }) => {
    const payload = JSON.stringify({ events: [] });
    const unsigned = await request.post('/api/line/webhook', {
      data: payload,
      headers: { 'content-type': 'application/json' },
    });
    expect(unsigned.status()).toBe(403);

    const forged = await request.post('/api/line/webhook', {
      data: payload,
      headers: {
        'content-type': 'application/json',
        'x-line-signature': Buffer.from('forged-signature').toString('base64'),
      },
    });
    expect(forged.status()).toBe(403);
  });
});
