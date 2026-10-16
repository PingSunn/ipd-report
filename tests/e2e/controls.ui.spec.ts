import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

type Shift = 'เช้า' | 'บ่าย' | 'ดึก';

type CensusRecord = {
  id: string;
  date: string;
  shift: Shift;
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
  updatedAt: string;
};

const records: CensusRecord[] = [
  {
    id: 'controls-fixture-1',
    date: '2099-11-01',
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
    note: 'controls fixture morning',
    updatedAt: '2099-11-01T08:00:00.000Z',
  },
  {
    id: 'controls-fixture-2',
    date: '2099-11-02',
    shift: 'บ่าย',
    totalPatients: 18,
    capacity: 30,
    availableBeds: 12,
    newPatients: 3,
    discharges: 2,
    referrals: 0,
    cat1: 3,
    cat2: 4,
    cat3: 5,
    cat4: 4,
    cat5: 2,
    note: 'controls fixture afternoon with a deliberately long note for width checks',
    updatedAt: '2099-11-02T16:00:00.000Z',
  },
];

const settings = {
  id: 'default' as const,
  hospitalName: 'โรงพยาบาลองครักษ์',
  wardName: 'ตึกผู้ป่วยใน',
  defaultCapacity: 30,
  reportFormat: 'standard' as const,
  includeCapacityAndOccupancy: true,
  includeCategories: true,
  includeWorkloadHours: false,
  includeNote: true,
  lineEnabled: false,
  lineGroupId: 'Cqa_verified_group_A',
  nightSendTime: '08:00',
  morningSendTime: '16:00',
  afternoonSendTime: '00:00',
  timezone: 'Asia/Bangkok' as const,
  updatedAt: '2099-11-01T00:00:00.000Z',
};

const settingsResponse = {
  success: true as const,
  settings,
  lineStatus: {
    accessTokenConfigured: false,
    webhookSecretConfigured: false,
    workerLastSeenAt: null,
  },
  groups: [{
    groupId: 'Cqa_verified_group_A',
    firstSeen: '2099-11-01T00:00:00.000Z',
    lastSeen: '2099-11-02T00:00:00.000Z',
  }],
};

async function installReadOnlyFixtures(page: Page, writes: string[]): Promise<void> {
  await page.route('**/api/census**', async (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, records, serverTime: '2099-11-02T16:00:00.000Z' }),
    });
  });
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settingsResponse) });
  });
  await page.route('**/api/line/history**', async (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, history: [] }) });
  });
}

async function openDatePicker(page: Page, id: string): Promise<Locator> {
  const input = page.locator(`#${id}`);
  const field = input.locator('xpath=..');
  await field.getByRole('button').last().click();
  const calendar = page.locator('[data-slot="calendar"]').last();
  await expect(calendar).toBeVisible();
  return calendar;
}

function reviewPath(testInfo: TestInfo, surface: string, state: string): string {
  const viewport = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
  return `.impeccable/review/controls-${viewport}-${surface}-${state}.png`;
}

async function captureReview(page: Page, path: string): Promise<void> {
  if (!shouldCapture(path)) return;
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path, fullPage: true });
}

async function captureOverlayReview(page: Page, path: string): Promise<void> {
  if (!shouldCapture(path)) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({ path, fullPage: false });
}

function shouldCapture(path: string): boolean {
  const mode = process.env.CAPTURE_REVIEW;
  if (mode === '0') return false;
  if (mode === 'history-datepicker-only') {
    return path.endsWith('controls-mobile-history-datepicker-open.png');
  }
  return true;
}

async function ensureListboxOpen(page: Page, trigger: Locator): Promise<void> {
  if (!(await page.getByRole('listbox').isVisible())) await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe('shared control behavior', () => {
  test('keeps date pickers, selects, validation, and readonly review surfaces stable', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const writes: string[] = [];
    await installReadOnlyFixtures(page, writes);

    await page.goto('/entry', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'บันทึกยอดผู้ป่วยประจำเวร' })).toBeVisible();
    const entryDate = page.locator('#report-date');
    await entryDate.fill('2099-12-31');
    await entryDate.press('Tab');
    await expect(entryDate).toHaveValue('31/12/2642');
    await expectWithinViewport(page, entryDate);

    const entryCalendar = await openDatePicker(page, 'report-date');
    await expect(entryCalendar).toContainText('ธันวาคม');
    await captureOverlayReview(page, reviewPath(testInfo, 'entry', 'datepicker-open'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(entryDate).toHaveValue('01/01/2643');
    await expect(entryCalendar).toBeHidden();
    await openDatePicker(page, 'report-date');
    await page.keyboard.press('Escape');
    await expect(entryCalendar).toBeHidden();

    const shiftTrigger = page.locator('#report-shift');
    await shiftTrigger.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(page.getByRole('listbox')).toBeVisible();
    await captureOverlayReview(page, reviewPath(testInfo, 'entry', 'shift-dropdown-open'));
    await ensureListboxOpen(page, shiftTrigger);
    const afternoonOption = page.getByRole('option', { name: /เวรบ่าย/ });
    await afternoonOption.focus();
    await afternoonOption.press('Enter');
    await expect(shiftTrigger).toContainText('เวรบ่าย');
    await expectWithinViewport(page, shiftTrigger);
    await page.locator('#report-date').fill('');
    await entryDate.press('Enter');
    await expect(entryDate).toHaveValue('');
    await expect(entryDate).toHaveAttribute('aria-invalid', 'true');
    await expect(writes).toEqual([]);
    await page.locator('main').getByRole('button', { name: 'บันทึกยอดเวร' }).last().click();
    await expect(page.getByText(/กรุณาระบุวันที่ให้ถูกต้อง/)).toBeVisible();
    await expect(page.getByRole('button', { name: /คัดลอก/ })).toHaveCount(0);
    await expect(page.getByText('Preview ข้อความ LINE')).toBeVisible();
    await expect(writes).toEqual([]);

    await page.goto('/history', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'ประวัติรายงานยอดผู้ป่วย' })).toBeVisible();
    const dateFilter = page.getByRole('combobox', { name: 'กรองตามช่วงวันที่' });
    await dateFilter.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option')).toHaveCount(5);
    await expect(page.getByRole('listbox')).toBeVisible();
    await captureOverlayReview(page, reviewPath(testInfo, 'history', 'filter-open'));
    await ensureListboxOpen(page, dateFilter);
    const customFilterOption = page.getByRole('option', { name: 'วันที่กำหนด' });
    await customFilterOption.focus();
    await customFilterOption.press('Enter');
    await expect(dateFilter).toContainText('วันที่กำหนด');
    const customDate = page.getByRole('textbox', { name: 'วันที่กำหนด' });
    const historyCalendar = await openDatePicker(page, 'custom-date');
    await expect(customDate).toHaveAttribute('placeholder', /พ\.ศ\./);
    await expect.poll(async () => customDate.evaluate((input) => input.scrollWidth <= input.clientWidth)).toBe(true);
    await captureOverlayReview(page, reviewPath(testInfo, 'history', 'datepicker-open'));
    await page.keyboard.press('Escape');
    await expect(historyCalendar).toBeHidden();
    await customDate.fill('31/02/2642');
    await customDate.press('Tab');
    await expect.poll(async () => customDate.evaluate((input) => (input as HTMLInputElement).checkValidity())).toBe(false);
    await page.getByRole('button', { name: 'ล้างวันที่' }).click();
    await expect.poll(async () => customDate.evaluate((input) => (input as HTMLInputElement).checkValidity())).toBe(true);
    await customDate.fill('2099-11-02');
    await customDate.press('Tab');
    await expect(customDate).toHaveValue('02/11/2642');
    const visibleHistory = page.locator('article:visible, table:visible');
    await expect(visibleHistory.getByText('2 พ.ย. 2642', { exact: true })).toBeVisible();
    await expect(visibleHistory.getByText('1 พ.ย. 2642', { exact: true })).toHaveCount(0);
    await customDate.fill('');
    await expect(visibleHistory.getByText('1 พ.ย. 2642', { exact: true })).toBeVisible();
    const historySearch = page.getByRole('textbox', { name: 'ค้นหารายการ' });
    await historySearch.fill('controls-fixture-2');
    await expect(visibleHistory.getByText('2 พ.ย. 2642', { exact: true })).toBeVisible();
    await historySearch.fill('');
    await expect(visibleHistory.getByText('1 พ.ย. 2642', { exact: true })).toBeVisible();
    await expectWithinViewport(page, dateFilter);

    await page.goto(`/line?id=${encodeURIComponent(records[0].id)}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'สรุปข้อความสำหรับ LINE' })).toBeVisible();
    const lineTrigger = page.locator('#line-record');
    await lineTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option')).toHaveCount(records.length);
    await expect(page.getByRole('listbox')).toBeVisible();
    await captureOverlayReview(page, reviewPath(testInfo, 'line', 'record-dropdown-open'));
    await ensureListboxOpen(page, lineTrigger);
    const longRecordOption = page.getByRole('option', { name: /2 พ.ย. 2642 · บ่าย · 18 ราย/ });
    await expect(longRecordOption).toBeVisible();
    await longRecordOption.click();
    await expect(lineTrigger).toContainText('2 พ.ย. 2642');
    await expectWithinViewport(page, lineTrigger);

    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'ตั้งค่าระบบ' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'มาตรฐาน' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'บันทึกการตั้งค่า' })).toBeDisabled();
    const verifiedGroupTrigger = page.locator('#verified-line-group');
    await verifiedGroupTrigger.click();
    await expect(page.getByRole('option', { name: 'Cqa_verified_group_A' })).toBeVisible();
    await expect(page.getByRole('listbox')).toBeVisible();
    await captureOverlayReview(page, reviewPath(testInfo, 'settings', 'group-dropdown-open'));
    await ensureListboxOpen(page, verifiedGroupTrigger);
    await page.keyboard.press('Escape');
    await page.locator('#line-group-id').fill('manual-unverified-group');
    await expect(verifiedGroupTrigger).toContainText('เลือกจาก verified groups');
    await expect(page.getByRole('checkbox', { name: 'เปิดการส่ง LINE อัตโนมัติ' })).toBeDisabled();
    await page.locator('#line-group-id').fill('');
    await expect(verifiedGroupTrigger).toContainText('เลือกจาก verified groups');
    await expect(page.getByRole('checkbox', { name: 'เปิดการส่ง LINE อัตโนมัติ' })).toBeDisabled();
    await captureReview(page, reviewPath(testInfo, 'settings', 'controls'));

    expect(writes, 'fixture-only control review must not mutate census, settings, or LINE delivery state').toEqual([]);
  });

  test('keeps date parsing independent of timezone boundaries', async ({ page }) => {
    const writes: string[] = [];
    await installReadOnlyFixtures(page, writes);
    await page.goto('/entry', { waitUntil: 'networkidle' });
    const dateInput = page.locator('#report-date');
    await dateInput.fill('2026-10-15');
    await dateInput.press('Tab');
    await expect(dateInput).toHaveValue('15/10/2569');
    await dateInput.fill('2026-01-01');
    await dateInput.press('Tab');
    await expect(dateInput).toHaveValue('01/01/2569');
    expect(writes).toEqual([]);
  });
});
