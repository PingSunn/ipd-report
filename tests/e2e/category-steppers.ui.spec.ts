import { expect, test } from '@playwright/test';

test('patient categories support touch-friendly decrement and increment controls', async ({
  page,
}) => {
  await page.goto('/entry', { waitUntil: 'networkidle' });

  const decrementButtons = page.getByRole('button', { name: /^ลด ประเภท [1-5]$/ });
  const incrementButtons = page.getByRole('button', { name: /^เพิ่ม ประเภท [1-5]$/ });
  await expect(decrementButtons).toHaveCount(5);
  await expect(incrementButtons).toHaveCount(5);

  const firstCategory = page.locator('#cat1');
  await expect(firstCategory).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'ลด ประเภท 1' })).toBeDisabled();

  await page.getByRole('button', { name: 'เพิ่ม ประเภท 1' }).click();
  await expect(firstCategory).toHaveValue('1');
  await expect(page.getByText('จำแนก 1 / 0 ราย')).toBeVisible();

  await firstCategory.fill('3');
  await page.getByRole('button', { name: 'ลด ประเภท 1' }).click();
  await expect(firstCategory).toHaveValue('2');

  const firstDecrementBox = await page
    .getByRole('button', { name: 'ลด ประเภท 1' })
    .boundingBox();
  expect(firstDecrementBox?.width).toBeGreaterThanOrEqual(44);
  expect(firstDecrementBox?.height).toBeGreaterThanOrEqual(44);
});
