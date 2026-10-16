import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';

type Shift = 'เช้า' | 'บ่าย' | 'ดึก';

type CensusPayload = {
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
};

type CensusListResponse = {
  records?: Array<{ id: string; date: string; note: string }>;
};

type CensusSaveResponse = {
  record?: { id: string };
};

const runToken = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const qaYear = 3000 + ((Date.now() + Math.floor(Math.random() * 10_000)) % 6000);

function recordFor(projectName: string): CensusPayload {
  const suffix = projectName === 'mobile' ? 'MOBILE' : 'DESKTOP';
  return {
    id: `QA-TEMP-${runToken}-${suffix}`,
    date: `${qaYear}-03-${projectName === 'mobile' ? '16' : '15'}`,
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
    note: 'QA temporary',
  };
}

function selectorRecord(
  projectName: string,
  suffix: string,
  date: string,
  shift: Shift,
): CensusPayload {
  return {
    ...recordFor(projectName),
    id: `QA-SELECTOR-${runToken}-${projectName}-${suffix}`,
    date,
    shift,
  };
}

async function createRecord(request: APIRequestContext, record: CensusPayload): Promise<string> {
  const response = await request.post('/api/census', {
    data: record,
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as CensusSaveResponse;
  expect(body.record?.id).toBeTruthy();
  return body.record?.id ?? record.id;
}

async function deleteRecord(request: APIRequestContext, id: string): Promise<void> {
  const response = await request.delete(`/api/census/${encodeURIComponent(id)}`);
  expect([200, 404]).toContain(response.status());
}

async function expectRecordVisible(page: Page, date: string): Promise<void> {
  const thaiYear = Number(date.slice(0, 4)) + 543;
  const day = String(Number(date.slice(8, 10)));
  const month = Number(date.slice(5, 7)) - 1;
  const shortMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const fullMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const datePattern = new RegExp(`${day} (?:${shortMonths[month]}|${fullMonths[month]}) ${thaiYear}`);
  await expect(page.locator('h2:visible, p:visible').filter({ hasText: datePattern }).first()).toBeVisible();
}

function shortThaiDate(date: string): string {
  const thaiYear = Number(date.slice(0, 4)) + 543;
  const day = String(Number(date.slice(8, 10)));
  const month = Number(date.slice(5, 7)) - 1;
  const shortMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${day} ${shortMonths[month]} ${thaiYear}`;
}

function screenshotPath(testInfo: TestInfo, surface: 'overview' | 'entry' | 'line' | 'history' | 'analytics'): string {
  const prefix = testInfo.project.name === 'mobile' ? 'mobile' : 'desktop';
  if (surface === 'line' && process.env.CAPTURE_REVIEW === 'plain-line') {
    return `.impeccable/review/line-plain-${prefix}.png`;
  }
  return `.impeccable/review/${prefix}${surface === 'overview' ? '' : `-${surface}`}.png`;
}

async function captureStableScreenshot(page: Page, path: string): Promise<void> {
  if (process.env.CAPTURE_REVIEW === '0') return;
  if (process.env.CAPTURE_REVIEW === 'plain-line' && !path.includes('/line-plain-')) return;
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText(/^\d+ Issue$/, { exact: true })).toHaveCount(0);
  await page.screenshot({ path, fullPage: true });
}

async function selectRadixOption(page: Page, trigger: Locator, optionName: RegExp | string): Promise<void> {
  await trigger.click();
  const option = page.getByRole('option', { name: optionName }).first();
  await expect(option).toBeVisible();
  await option.click();
}

test.describe('live census UI', () => {
  test('groups recent shifts by date and preserves nursing order', async ({ page, request }, testInfo) => {
    const currentDate = `${qaYear}-03-19`;
    const previousDate = `${qaYear}-03-18`;
    const records = [
      selectorRecord(testInfo.project.name, 'NIGHT', currentDate, 'ดึก'),
      selectorRecord(testInfo.project.name, 'MORNING', currentDate, 'เช้า'),
      selectorRecord(testInfo.project.name, 'AFTERNOON', currentDate, 'บ่าย'),
      selectorRecord(testInfo.project.name, 'PREVIOUS', previousDate, 'บ่าย'),
    ];
    const cleanupIds = new Set<string>();

    try {
      for (const record of records) cleanupIds.add(await createRecord(request, record));
      await page.goto('/', { waitUntil: 'networkidle' });

      const selector = page.getByRole('group', { name: 'เวรล่าสุด', exact: true });
      await expect(selector).toBeVisible();
      const firstDateGroup = selector.locator('[role="group"]').filter({
        has: page.getByRole('heading', { name: shortThaiDate(currentDate), exact: true }),
      });
      await expect(firstDateGroup).toHaveCount(1);
      await expect(firstDateGroup.getByRole('heading', { name: shortThaiDate(currentDate), exact: true })).toHaveCount(1);
      await expect(firstDateGroup.getByRole('button')).toHaveText(['เวรดึก', 'เวรเช้า', 'เวรบ่าย']);

      const nightButton = firstDateGroup.getByRole('button', {
        name: new RegExp(`^เวรดึก ${shortThaiDate(currentDate)}(?: เลือกอยู่)?$`),
      });
      await nightButton.click();
      await expect(nightButton).toHaveAttribute('aria-pressed', 'true');
      await expect(firstDateGroup.getByRole('button', {
        name: new RegExp(`^เวรบ่าย ${shortThaiDate(currentDate)}$`),
      })).toHaveAttribute('aria-pressed', 'false');
    } finally {
      for (const id of cleanupIds) await deleteRecord(request, id);
    }
  });

  test('keeps CRUD/reporting flows usable on desktop and mobile', async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    const record = recordFor(testInfo.project.name);
    const editedDate = `${qaYear}-03-${testInfo.project.name === 'mobile' ? '18' : '17'}`;
    const cleanupIds = new Set<string>();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));

    try {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(process.env.BASE_URL ?? 'http://localhost:3000').origin,
      });
      record.id = await createRecord(request, record);
      cleanupIds.add(record.id);

      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'รายงานยอดผู้ป่วยประจำเวร' })).toBeVisible();
      await expectRecordVisible(page, record.date);
      await captureStableScreenshot(page, screenshotPath(testInfo, 'overview'));

      await page.goto(`/entry?id=${encodeURIComponent(record.id)}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'แก้ไขยอดผู้ป่วยประจำเวร' })).toBeVisible();
      await captureStableScreenshot(page, screenshotPath(testInfo, 'entry'));
      await page.locator('#report-date').fill(editedDate);
      await selectRadixOption(page, page.locator('#report-shift'), /เวรบ่าย/);
      await page.locator('#total-patients').fill('13');
      await page.locator('#report-note').fill('QA temporary edited');
      await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expectRecordVisible(page, editedDate);

      await page.goto('/entry', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'บันทึกยอดผู้ป่วยประจำเวร' })).toBeVisible();
      await page.locator('#report-date').fill(record.date);
      await selectRadixOption(page, page.locator('#report-shift'), /เวรเช้า/);
      await page.locator('#total-patients').fill('11');
      await page.locator('#report-note').fill('QA temporary new slot');
      await page.getByRole('button', { name: 'บันทึกยอดเวร' }).last().click();
      await expect(page).toHaveURL(/\/$/);
      await expectRecordVisible(page, record.date);
      const recordsResponse = await request.get('/api/census');
      expect(recordsResponse.status()).toBe(200);
      const recordsBody = (await recordsResponse.json()) as CensusListResponse;
      const newSlot = recordsBody.records?.find(
        (item) => item.date === record.date && item.note === 'QA temporary new slot'
      );
      if (!newSlot) throw new Error('UI-created QA temporary record was not returned by the API');
      cleanupIds.add(newSlot.id);

      await page.goto(`/line?id=${encodeURIComponent(record.id)}`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'สรุปข้อความสำหรับ LINE' })).toBeVisible();
      await expect(page.locator('#line-record')).toContainText(shortThaiDate(editedDate));
      const lineText = page.locator('#line-text');
      await expect(page.getByRole('radio', { name: 'กระชับ' })).toBeChecked();
      await expect(lineText).toHaveValue(new RegExp(`${shortThaiDate(editedDate)} · เวรบ่าย`));
      await expect(lineText).toHaveValue(/ผู้ป่วย 13 ราย/);
      await expect(lineText).toHaveValue(/รับใหม่ 2/);
      await expect(lineText).toHaveValue(/จำหน่าย 1/);
      await expect(lineText).toHaveValue(/ส่งต่อ 1/);
      await expect(lineText).toHaveValue(/ประเภทผู้ป่วย\nประเภท 1 \(อาการน้อยสุด\): 2 ราย\nประเภท 2 \(อาการน้อย\): 3 ราย\nประเภท 3 \(อาการปานกลาง\): 4 ราย\nประเภท 4 \(อาการหนัก \/ กึ่งวิกฤต\): 2 ราย\nประเภท 5 \(วิกฤต \/ หนักมาก\): 1 ราย/);
      await expect(lineText).not.toHaveValue(/โรงพยาบาลองครักษ์|ตึกผู้ป่วยใน|ผู้รายงาน|รายงานยอดผู้ป่วย|สรุปยอดผู้ป่วย|สรุปแยกประเภทผู้ป่วย|การเคลื่อนไหวในเวร|────|08:00|16:00|00:00/);
      await page.getByRole('radio', { name: 'มาตรฐาน' }).click();
      await expect(page.getByRole('radio', { name: 'มาตรฐาน' })).toBeChecked();
      await expect(lineText).toHaveValue(new RegExp(`${shortThaiDate(editedDate)} · เวรบ่าย`));
      await expect(lineText).toHaveValue(/ผู้ป่วย 13 ราย/);
      await page.getByRole('radio', { name: 'กระชับ' }).click();
      await expect(lineText).toHaveValue(new RegExp(`${shortThaiDate(editedDate)} · เวรบ่าย`));
      await expect(lineText).toHaveValue(/ผู้ป่วย 13 ราย/);
      await page.getByRole('radio', { name: 'ละเอียด' }).click();
      await expect(lineText).toHaveValue(/ภาระงานพยาบาล 43(?:\.0)? ชม\.\/วัน/);
      await expect(lineText).not.toHaveValue(/โรงพยาบาลองครักษ์|ตึกผู้ป่วยใน|ผู้รายงาน|รายงานยอดผู้ป่วย|สรุปยอดผู้ป่วย|สรุปแยกประเภทผู้ป่วย|การเคลื่อนไหวในเวร|────|08:00|16:00|00:00/);
      const workloadCheckbox = page.getByRole('checkbox', { name: 'ภาระงานโดยประมาณ' });
      await expect(workloadCheckbox).toBeChecked();
      await expect(workloadCheckbox).toBeDisabled();
      await expect(lineText).toHaveValue(/หมายเหตุ: QA temporary edited/);
      if (process.env.CAPTURE_REVIEW === 'plain-line') {
        await captureStableScreenshot(page, screenshotPath(testInfo, 'line'));
      }
      await lineText.fill('QA temporary LINE report\nแก้ไขข้อความด้วยมือ');
      await page.getByRole('button', { name: 'คัดลอกข้อความ' }).click();
      await expect(page.getByRole('button', { name: 'คัดลอกแล้ว' })).toBeVisible();
      await expect
        .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('QA temporary LINE report\nแก้ไขข้อความด้วยมือ');
      if (process.env.CAPTURE_REVIEW !== 'plain-line') {
        await captureStableScreenshot(page, screenshotPath(testInfo, 'line'));
      }

      await page.goto('/history', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'ประวัติรายงานยอดผู้ป่วย' })).toBeVisible();
      const search = page.getByRole('textbox', { name: 'ค้นหารายการ' });
      for (const term of [editedDate, record.id, 'บ่าย', 'QA temporary edited']) {
        await search.fill(term);
        await expectRecordVisible(page, editedDate);
      }
      await search.fill('');
      const dateFilter = page.getByRole('combobox', { name: 'กรองตามช่วงวันที่' });
      await dateFilter.click();
      await expect(page.getByRole('option')).toHaveCount(5);
      await page.getByRole('option', { name: 'วันที่กำหนด' }).click();
      await page.getByRole('textbox', { name: 'วันที่กำหนด' }).fill(editedDate);
      await expectRecordVisible(page, editedDate);
      await page.getByRole('button', { name: 'บ่าย' }).click();
      await expectRecordVisible(page, editedDate);
      await selectRadixOption(page, dateFilter, 'ทุกช่วงเวลา');
      await captureStableScreenshot(page, screenshotPath(testInfo, 'history'));

      await page.evaluate(() => {
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (object: Blob | MediaSource): string => {
          if (object instanceof Blob) {
            void object.arrayBuffer().then((buffer) => {
              const bytes = Array.from(new Uint8Array(buffer));
              Object.defineProperty(window, '__qaCsvBytes', {
                configurable: true,
                value: bytes,
              });
            });
          }
          return originalCreateObjectURL(object);
        };
      });

      if (testInfo.project.name === 'desktop') {
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'ส่งออก CSV' }).click();
        const download = await downloadPromise;
        const downloadStream = await download.createReadStream();
        if (!downloadStream) throw new Error('CSV download stream was unavailable');
        const chunks: Buffer[] = [];
        for await (const chunk of downloadStream) chunks.push(Buffer.from(chunk));
        const csv = Buffer.concat(chunks).toString('utf8');
        expect(csv.charCodeAt(0)).toBe(0xfeff);
        expect(csv).toContain('วันที่');
        expect(csv).toContain('QA temporary edited');
      } else {
        // Mobile Chromium's download stream stalls in this emulation, so verify
        // the browser-produced Blob bytes before the harness download layer.
        await page.getByRole('button', { name: 'ส่งออก CSV' }).click();
        await expect
          .poll(async () =>
            page.evaluate(
              () =>
                ((window as Window & { __qaCsvBytes?: number[] }).__qaCsvBytes ?? [])
                  .length
            )
          )
          .toBeGreaterThan(3);
        const browserCsvBytes = await page.evaluate(
          () => (window as Window & { __qaCsvBytes?: number[] }).__qaCsvBytes ?? []
        );
        expect(browserCsvBytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
        const browserCsv = Buffer.from(browserCsvBytes).toString('utf8');
        expect(browserCsv).toContain('วันที่');
        expect(browserCsv).toContain('QA temporary edited');
      }

      const deleteButton = testInfo.project.name === 'mobile'
        ? page.locator('article:visible').getByRole('button', { name: 'ลบ' }).first()
        : page.getByRole('button', { name: /ลบรายการ/ }).first();
      await deleteButton.click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button', { name: 'ยกเลิก' }).click();
      await expect(page.getByRole('alertdialog')).toBeHidden();

      await page.goto('/analytics', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'แนวโน้มผู้ป่วยคงเหลือเทียบศักยภาพเตียง' })).toBeVisible();
      await expect(page.getByRole('img', { name: 'กราฟแนวโน้มผู้ป่วยคงเหลือเทียบศักยภาพเตียง' })).toBeVisible();
      const movementTable = page.getByRole('table');
      await expect(movementTable).toBeVisible();
      await expect(movementTable.getByRole('columnheader')).toHaveText([
        'เวรปฏิบัติงาน',
        'เฉลี่ยคงเหลือ',
        'รับใหม่รวม',
        'จำหน่ายรวม',
        'ส่งต่อรวม',
      ]);
      await expect(movementTable.getByRole('row')).toHaveCount(4);
      await expect(movementTable.getByRole('rowheader')).toHaveText([
        /เวรดึก/,
        /เวรเช้า/,
        /เวรบ่าย/,
      ]);
      await expect
        .poll(async () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
      const categoryLegend = page.getByRole('group', { name: 'คำอธิบายสัดส่วนผู้ป่วย' });
      await expect(categoryLegend.getByRole('button')).toHaveCount(5);
      await expect
        .poll(async () =>
          categoryLegend.evaluate((element) => element.scrollWidth <= element.clientWidth),
        )
        .toBe(true);
      await page.getByRole('button', { name: '30 เวร' }).click();
      await captureStableScreenshot(page, screenshotPath(testInfo, 'analytics'));

      await page.goBack({ waitUntil: 'networkidle' });
      await expect(page).toHaveURL(/\/history$/);
      await expect(page.getByRole('heading', { name: 'ประวัติรายงานยอดผู้ป่วย' })).toBeVisible();

      const finalSearch = page.getByRole('textbox', { name: 'ค้นหารายการ' });
      await finalSearch.fill(record.id);
      await expectRecordVisible(page, editedDate);
      const finalDeleteButton = testInfo.project.name === 'mobile'
        ? page.locator('article:visible').getByRole('button', { name: 'ลบ' }).first()
        : page.getByRole('button', { name: new RegExp(`ลบรายการ ${editedDate}`) }).first();
      await finalDeleteButton.click();
      const deleteDialog = page.getByRole('alertdialog');
      await expect(deleteDialog).toBeVisible();
      await deleteDialog.getByRole('button', { name: 'ลบรายการ', exact: true }).click();
      await expect(deleteDialog).toBeHidden();
      await expect
        .poll(async () => {
          const response = await request.get('/api/census');
          expect(response.status()).toBe(200);
          const body = (await response.json()) as CensusListResponse;
          return body.records?.some((item) => item.id === record.id) ?? false;
        })
        .toBe(false);
      await expect
        .poll(async () => {
          const response = await request.get('/api/census');
          expect(response.status()).toBe(200);
          const body = (await response.json()) as CensusListResponse;
          return body.records?.some((item) => item.id === newSlot.id) ?? false;
        })
        .toBe(true);
      cleanupIds.delete(record.id);
      expect(pageErrors, 'browser page errors').toEqual([]);
    } finally {
      for (const id of cleanupIds) await deleteRecord(request, id);
    }
  });

  test('shows retryable API failure without localStorage fallback', async ({ page }) => {
    await page.route('**/api/census*', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert').getByText('โหลดข้อมูลไม่สำเร็จ')).toBeVisible();
    await expect.poll(async () => page.evaluate(() => Object.keys(localStorage))).toEqual([]);

    await page.unroute('**/api/census*');
    await page.getByRole('button', { name: 'ลองใหม่' }).click();
    await expect(page.getByRole('heading', { name: /^สรุปเวร/ })).toBeVisible();
    await expect(page.getByText('6 เวร', { exact: true })).toBeVisible();
  });
});
