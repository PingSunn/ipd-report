import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type SettingsResponse = {
  success: boolean;
  settings?: { wardName: string };
};

const routes = [
  { path: '/', heading: 'รายงานยอดผู้ป่วยประจำเวร' },
  { path: '/entry', heading: 'บันทึกยอดผู้ป่วยประจำเวร' },
  { path: '/line', heading: 'สรุปข้อความสำหรับ LINE' },
  { path: '/history', heading: 'ประวัติรายงานยอดผู้ป่วย' },
  { path: '/analytics', heading: 'แนวโน้มผู้ป่วยคงเหลือเทียบศักยภาพเตียง' },
  { path: '/settings', heading: 'ตั้งค่าระบบ' },
] as const;

const semanticTokens = {
  '--background': '#edf5f7',
  '--foreground': '#102a43',
  '--brand-cyan-strong': '#06717e',
  '--brand-emerald-strong': '#08705a',
  '--destructive-strong': '#9f2933',
  '--category-1': '#1caf83',
  '--category-2': '#16a7b8',
  '--category-3': '#3578c6',
  '--category-4': '#e1a22b',
  '--category-5': '#cf4f57',
  '--surface-aqua': '#dff5f4',
  '--surface-cyan': '#dceff5',
  '--surface-emerald': '#e2f4ed',
  '--surface-warning': '#fff1d6',
  '--surface-danger': '#fde4e5',
  '--category-1-surface': '#e6f7f1',
  '--category-2-surface': '#e2f6f8',
  '--category-3-surface': '#e8f0fa',
  '--category-4-surface': '#fff5df',
  '--category-5-surface': '#fbeaec',
} as const;

async function getWardName(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/settings');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as SettingsResponse;
  expect(body.success).toBe(true);
  const wardName = body.settings?.wardName;
  expect(wardName).toBeTruthy();
  return wardName ?? '';
}

async function assertNoViewportOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, 'document must not overflow horizontally').toBeLessThanOrEqual(
    dimensions.clientWidth,
  );
}

test.describe('whole-app Ocean Health rebrand contract', () => {
  test('keeps semantic tokens, routes, identity, and read-only browser behavior intact', async ({ page, request }) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const writes: string[] = [];
    const originalViewport = page.viewportSize();
    const wardName = await getWardName(request);

    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    page.on('request', (request) => {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });

    try {
      for (const route of routes) {
        const response = await page.goto(route.path, { waitUntil: 'networkidle' });
        expect(response?.status(), `${route.path} should load`).toBe(200);
        await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
        await assertNoViewportOverflow(page);
        await expect(page.locator('body')).toContainText(wardName);
        expect(await page.content()).not.toMatch(/ocean health/i);

        if (route.path === '/settings') {
          await expect(page.locator('#ward-name')).toHaveValue(wardName);
        }
      }

      const tokenValues = await page.evaluate((names) => {
        const styles = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          names.map((name) => [name, styles.getPropertyValue(name).trim()]),
        );
      }, Object.keys(semanticTokens));
      expect(tokenValues).toEqual(semanticTokens);

      await page.setViewportSize({ width: 320, height: originalViewport?.height ?? 844 });
      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'รายงานยอดผู้ป่วยประจำเวร', exact: true })).toBeVisible();
      await assertNoViewportOverflow(page);
      const headerDimensions = await page.locator('header').evaluate((header) => ({
        clientWidth: header.clientWidth,
        scrollWidth: header.scrollWidth,
        right: header.getBoundingClientRect().right,
      }));
      expect(headerDimensions.scrollWidth, '320px header must not overflow internally').toBeLessThanOrEqual(
        headerDimensions.clientWidth,
      );
      expect(headerDimensions.right, '320px header must stay inside viewport').toBeLessThanOrEqual(320);
    } finally {
      if (originalViewport) await page.setViewportSize(originalViewport);
    }

    expect(pageErrors, 'browser page errors').toEqual([]);
    expect(consoleErrors, 'browser console errors').toEqual([]);
    expect(failedRequests, 'failed network requests').toEqual([]);
    expect(writes, 'rebrand review must not mutate data or settings').toEqual([]);
  });
});
