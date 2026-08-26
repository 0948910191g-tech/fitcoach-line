import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('onboarding is mobile-first, calculates a preview, and requires explicit confirmation', async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route('**/api/auth/line/exchange', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (body.action === 'preview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: {
            ageYears: 30,
            bmrKcal: 1320,
            tdeeKcal: 2046,
            targetCaloriesKcal: 2046,
            targetProteinG: 96,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ saved: true }),
    });
  });

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
  await page.goto(new URL('/onboarding', baseUrl).toString());
  await expect(page.getByRole('heading', { name: 'เริ่มต้นให้โค้ชช่วยได้ตรงเป้าหมาย' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'เข้าสู่ระบบด้วย LINE' }).first()).toBeVisible();

  await page.getByLabel('เพศ').selectOption('female');
  await page.getByLabel('วันเกิด').fill('1996-08-25');
  await page.getByLabel('ส่วนสูง (ซม.)').fill('165');
  await page.getByLabel('น้ำหนักปัจจุบัน (กก.)').fill('60');
  await page.getByLabel('ระดับกิจกรรม').selectOption('moderate');
  await page.getByLabel('ประสบการณ์ฝึก').selectOption('beginner');
  await page.getByLabel('เป้าหมาย').selectOption('maintain');
  await page.getByLabel('น้ำหนักเป้าหมาย (กก.)').fill('60');
  await page.getByLabel('จำนวนวันฝึกต่อสัปดาห์ (วัน)').selectOption('3');

  const save = page.getByRole('button', { name: 'ยืนยันและบันทึก' });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'คำนวณเป้าหมาย' }).click();

  await expect(page.getByText('30 ปี')).toBeVisible();
  await expect(page.getByText('2,046 kcal')).toHaveCount(2);
  await expect(page.getByText('96 g')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ action: 'preview' });
  expect(requests[0]).not.toHaveProperty('lineUserId');
  expect(requests[0]).not.toHaveProperty('providerId');
  expect(requests[0]).not.toHaveProperty('authUserId');

  const confirm = page.getByLabel('ฉันตรวจสอบค่าด้านบนแล้วและยืนยันให้บันทึก');
  await expect(save).toBeDisabled();
  await confirm.check();
  await expect(save).toBeEnabled();
});
