import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

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

type CensusRecord = {
  id: string;
  date: string;
  shift: 'เช้า' | 'บ่าย' | 'ดึก';
  totalPatients: number;
  capacity: number;
  availableBeds: number;
  newPatients: number;
  discharges: number;
  referrals: number;
  cat1: number;
  cat2: number;
  cat3: number;
  cat4: number;
  cat5: number;
  note: string;
};

type CensusResponse = { success: boolean; records?: CensusRecord[]; record?: CensusRecord };

const runToken = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const qaSettings: SettingsInput = {
  hospitalName: `QA Hospital ${runToken}`,
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

async function getSettings(request: APIRequestContext): Promise<SettingsResponse> {
  const response = await request.get('/api/settings');
  expect(response.status()).toBe(200);
  return (await response.json()) as SettingsResponse;
}

async function putSettings(request: APIRequestContext, input: SettingsInput): Promise<void> {
  const response = await request.put('/api/settings', {
    data: input,
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status()).toBe(200);
}

async function findFreeFutureDate(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/census');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as CensusResponse;
  const occupied = new Set(
    (body.records ?? []).filter((record) => record.shift === 'เช้า').map((record) => record.date),
  );
  const start = (Date.now() % 26) + 1;
  for (let offset = 0; offset < 26; offset += 1) {
    const day = String(((start + offset - 1) % 26) + 1).padStart(2, '0');
    const candidate = `2099-11-${day}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error('No free future census date was available for QA');
}

async function createRecord(request: APIRequestContext, date: string, id: string): Promise<void> {
  const record: CensusRecord = {
    id,
    date,
    shift: 'เช้า',
    totalPatients: 12,
    capacity: 30,
    availableBeds: 18,
    newPatients: 2,
    discharges: 1,
    referrals: 1,
    cat1: 2,
    cat2: 3,
    cat3: 4,
    cat4: 2,
    cat5: 1,
    note: 'QA clipboard note must be excluded',
  };
  const response = await request.post('/api/census', {
    data: record,
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as CensusResponse;
  expect(body.record?.id).toBe(id);
}

async function deleteRecord(request: APIRequestContext, id: string): Promise<void> {
  const response = await request.delete(`/api/census/${encodeURIComponent(id)}`);
  expect([200, 404]).toContain(response.status());
}

async function captureStableScreenshot(page: Page, testInfo: TestInfo, surface: 'settings' | 'overview'): Promise<void> {
  if (process.env.CAPTURE_REVIEW === '0' || process.env.CAPTURE_REVIEW === 'plain-line') return;
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText(/^\d+ Issue$/, { exact: true })).toHaveCount(0);
  await expect(page.locator('main').first()).toBeVisible();
  await page.screenshot({
    path: `.impeccable/review/${surface === 'settings' ? 'settings' : 'overview-noto'}-${testInfo.project.name}.png`,
    fullPage: true,
  });
}

test.describe('shared settings UI', () => {
  test('persists settings, keeps drafts through polling, applies reports, and is reachable responsively', async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    const original = await getSettings(request);
    expect(original.settings.lineEnabled, 'scheduled LINE must remain disabled in QA').toBe(false);
    const uiSettings: SettingsInput = { ...qaSettings, lineGroupId: original.settings.lineGroupId };
    const recordId = `QA-TEMP-${runToken}-${testInfo.project.name}-SETTINGS`;
    const recordDate = await findFreeFutureDate(request);
    const pageErrors: string[] = [];
    const hydrationErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydration|server-rendered|server rendered/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });

    try {
      await createRecord(request, recordDate, recordId);
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'รายงานยอดผู้ป่วยประจำเวร' })).toBeVisible();

      const bottomNav = page.getByRole('navigation', { name: 'เมนูด้านล่าง' });
      if (testInfo.project.name === 'mobile') {
        await expect(bottomNav).toBeVisible();
        await expect(bottomNav.getByRole('link')).toHaveCount(5);
        await page.getByRole('link', { name: 'เปิดตั้งค่าระบบ' }).click();
      } else {
        await expect(bottomNav).toBeHidden();
        await page.locator('aside').getByRole('link', { name: 'ตั้งค่า' }).first().click();
      }
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeVisible();
      const bodyFont = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
      expect(bodyFont).toContain('Noto Sans Thai');

      await page.locator('#hospital-name').fill('QA unsaved settings draft');
      await page.waitForTimeout(10_500);
      await expect(page.locator('#hospital-name')).toHaveValue('QA unsaved settings draft');

      await page.locator('#hospital-name').fill(uiSettings.hospitalName);
      await page.locator('#ward-name').fill(uiSettings.wardName);
      await page.locator('#default-capacity').fill(String(uiSettings.defaultCapacity));
      await page.getByRole('radio', { name: 'ละเอียด' }).check();
      await page.getByRole('checkbox', { name: 'เตียงและอัตราครองเตียง' }).uncheck();
      await page.getByRole('checkbox', { name: 'ประเภทผู้ป่วย 1–5' }).uncheck();
      await page.getByRole('checkbox', { name: 'ภาระงานพยาบาลโดยประมาณ' }).uncheck();
      await page.getByRole('checkbox', { name: 'หมายเหตุสำหรับ LINE-safe' }).uncheck();
      await page.locator('#line-group-id').fill(uiSettings.lineGroupId);
      await page.locator('#night-time').fill(uiSettings.nightSendTime);
      await page.locator('#morning-time').fill(uiSettings.morningSendTime);
      await page.locator('#afternoon-time').fill(uiSettings.afternoonSendTime);
      await expect(page.getByRole('checkbox', { name: 'เปิดการส่ง LINE อัตโนมัติ' })).not.toBeChecked();
      await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
      await expect(page.getByText('การตั้งค่าถูกบันทึกแล้ว', { exact: true })).toBeVisible();
      const saved = await getSettings(request);
      expect(saved.settings).toMatchObject(uiSettings);
      expect(saved.settings.lineEnabled).toBe(false);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('#hospital-name')).toHaveValue(uiSettings.hospitalName);
      await expect(page.locator('#default-capacity')).toHaveValue(String(uiSettings.defaultCapacity));
      await captureStableScreenshot(page, testInfo, 'settings');

      await page.goto('/entry', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'บันทึกยอดผู้ป่วยประจำเวร' })).toBeVisible();
      await expect(page.locator('#capacity')).toHaveValue(String(uiSettings.defaultCapacity));
      await page.locator('#total-patients').fill('11');
      await page.locator('#report-note').fill('QA census draft survives polling');
      await page.waitForTimeout(10_500);
      await expect.soft(page.locator('#total-patients')).toHaveValue('11');
      await expect.soft(page.locator('#report-note')).toHaveValue('QA census draft survives polling');

      await page.goto(`/entry?id=${encodeURIComponent(recordId)}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'แก้ไขยอดผู้ป่วยประจำเวร' })).toBeVisible();
      await expect(page.locator('#capacity')).toHaveValue('30');

      await page.goto(`/line?id=${encodeURIComponent(recordId)}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'สรุปข้อความสำหรับ LINE' })).toBeVisible();
      const lineText = page.locator('#line-text');
      const linePanel = page.locator('section').filter({ has: lineText }).last();
      await expect(linePanel).toContainText(uiSettings.hospitalName);
      await expect(linePanel).toContainText(uiSettings.wardName);
      await expect(lineText).not.toHaveValue(new RegExp(uiSettings.hospitalName));
      await expect(lineText).not.toHaveValue(/หน่วยงาน: QA IPD Ward/);
      await expect(lineText).not.toHaveValue(/เตียงทั้งหมด/);
      await expect(lineText).not.toHaveValue(/ประเภท 1/);
      await expect(lineText).not.toHaveValue(/รายงานยอดผู้ป่วย|สรุปยอดผู้ป่วย|การเคลื่อนไหวในเวร|────|ผู้รายงาน/);
      await expect(lineText).not.toHaveValue(/QA clipboard note must be excluded/);
      await expect(lineText).toHaveValue(/ภาระงานพยาบาล 43(?:\.0)? ชม\.\/วัน/);
      await page.getByRole('button', { name: 'คัดลอกข้อความ' }).click();
      await expect(page.getByRole('button', { name: 'คัดลอกแล้ว' })).toBeVisible();
      await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).not.toContain(uiSettings.hospitalName);
      await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).not.toContain(uiSettings.wardName);

      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.locator('p:visible').filter({ hasText: uiSettings.hospitalName }).first()).toBeVisible();
      await expect(page.locator('p:visible').filter({ hasText: uiSettings.wardName }).first()).toBeVisible();
      await captureStableScreenshot(page, testInfo, 'overview');
      expect(pageErrors, 'browser page errors').toEqual([]);
      expect(hydrationErrors, 'hydration console errors').toEqual([]);
    } finally {
      await deleteRecord(request, recordId);
      await putSettings(request, settingsInput(original.settings));
      const restored = await getSettings(request);
      expect(restored.settings).toMatchObject(settingsInput(original.settings));
      expect(restored.settings.lineEnabled).toBe(false);
    }
  });

  test('waits for delayed settings before initializing the first LINE report', async ({ page, request }, testInfo) => {
    test.setTimeout(45_000);
    const original = await getSettings(request);
    const recordId = `QA-TEMP-${runToken}-${testInfo.project.name}-LINE-SETTINGS-GATE`;
    const recordDate = await findFreeFutureDate(request);
    const delayedSettings: SettingsResponse = {
      ...original,
      settings: {
        ...original.settings,
        reportFormat: 'detailed',
        includeCapacityAndOccupancy: false,
        includeCategories: false,
        includeWorkloadHours: false,
        includeNote: false,
      },
    };
    let settingsRequestStarted = false;

    try {
      await createRecord(request, recordDate, recordId);
      await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        settingsRequestStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(delayedSettings),
        });
      });

      await page.goto(`/line?id=${encodeURIComponent(recordId)}`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => settingsRequestStarted).toBe(true);
      await expect(page.getByRole('status')).toContainText('กำลังโหลดการตั้งค่า…');
      await expect(page.locator('#line-text')).toHaveCount(0);

      await expect(page.getByRole('heading', { name: 'สรุปข้อความสำหรับ LINE' })).toBeVisible();
      await expect(page.getByRole('radio', { name: 'ละเอียด' })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'เตียงและอัตราครองเตียง' })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'ประเภทผู้ป่วย 1–5' })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'หมายเหตุสำหรับ LINE-safe' })).not.toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'ภาระงานโดยประมาณ' })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'ภาระงานโดยประมาณ' })).toBeDisabled();
      await expect(page.locator('#line-text')).toHaveValue(/ภาระงานพยาบาล/);
      await expect(page.locator('#line-text')).not.toHaveValue(/เตียงทั้งหมด|ประเภท 1|หมายเหตุ/);
    } finally {
      await deleteRecord(request, recordId);
    }
  });

  test('shows LINE enablement blocked when readiness flags are missing', async ({ page, request }) => {
    const original = await request.get('/api/settings');
    expect(original.status()).toBe(200);
    const originalBody = (await original.json()) as SettingsResponse;
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const body: SettingsResponse = {
        ...originalBody,
        lineStatus: {
          accessTokenConfigured: false,
          webhookSecretConfigured: false,
          workerLastSeenAt: null,
        },
        settings: { ...originalBody.settings, lineEnabled: false, lineGroupId: '' },
        groups: [],
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeVisible();
    const enabled = page.getByRole('checkbox', { name: 'เปิดการส่ง LINE อัตโนมัติ' });
    await expect(enabled).toBeDisabled();
    await expect(page.getByText('ยังเปิดไม่ได้จนกว่าจะมี Channel access token และ Group ID ที่ยืนยันจาก signed webhook')).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'Channel access token ใน environment' })).toContainText('ยังไม่ตั้งค่า');
    await expect(page.locator('li').filter({ hasText: 'Webhook secret ใน environment' })).toContainText('ยังไม่ตั้งค่า');
    await expect(page.locator('li').filter({ hasText: 'Group ID จาก signed webhook' })).toContainText('ยังไม่ยืนยัน');
  });

  test('keeps history loading and valid rows distinct across failure and retry states', async ({ page }) => {
    test.setTimeout(45_000);
    const historyFixture = {
      success: true,
      history: [{
        id: 'qa-history-fixture',
        reportDate: '2099-11-01',
        shift: 'เช้า',
        scheduledAt: '2099-11-01T01:00:00.000Z',
        kind: 'REPORT',
        status: 'SKIPPED',
        groupId: 'Cqa_history_fixture',
        attempts: 0,
        firstAttemptAt: null,
        nextAttemptAt: null,
        acceptedAt: null,
        lastError: null,
        createdAt: '2099-11-01T00:00:00.000Z',
        updatedAt: '2099-11-01T00:00:00.000Z',
      }],
    };
    let historyCalls = 0;
    let releaseInitialFailure: () => void = () => undefined;
    const initialFailureGate = new Promise<void>((resolve) => {
      releaseInitialFailure = resolve;
    });

    await page.route('**/api/line/history**', async (route) => {
      historyCalls += 1;
      if (historyCalls <= 2) {
        await initialFailureGate;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, history: [], error: 'QA initial history failure' }),
        });
        return;
      }
      if (historyCalls === 4) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, history: [], error: 'QA poll history failure' }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(historyFixture) });
    });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeVisible();
    await expect.poll(() => historyCalls).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByText('ยังไม่มีประวัติการส่ง', { exact: true })).toHaveCount(0);

    releaseInitialFailure();
    await expect(page.getByText('โหลดประวัติการส่งไม่สำเร็จ')).toBeVisible();
    await expect(page.getByText('QA initial history failure')).toBeVisible();
    await page.getByRole('button', { name: 'ลองใหม่' }).click();
    await expect(page.getByText('กลุ่ม Cqa_history_fixture')).toBeVisible();
    await expect(page.getByText('ยังไม่มีประวัติการส่ง', { exact: true })).toHaveCount(0);

    await expect.poll(() => historyCalls, { timeout: 16_000 }).toBeGreaterThanOrEqual(4);
    await expect(page.getByText('ประวัติอาจยังไม่ล่าสุด')).toBeVisible();
    await expect(page.getByText('QA poll history failure')).toBeVisible();
    await expect(page.getByText('กลุ่ม Cqa_history_fixture')).toBeVisible();
    await page.getByRole('button', { name: 'ลองใหม่' }).click();
    await expect(page.getByText('ประวัติอาจยังไม่ล่าสุด')).toHaveCount(0);
    await expect(page.getByText('กลุ่ม Cqa_history_fixture')).toBeVisible();
  });
});
