import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'liff', {
      configurable: true,
      value: {
        init: async () => undefined,
        isLoggedIn: () => true,
        login: () => undefined,
        getIDToken: () => 'synthetic.e2e.id-token',
      },
    });
  });

  await page.route('https://static.line-scdn.net/**', async (route) => route.abort());
});

test('iPhone onboarding previews goals before one explicit confirmed save', async ({ page }) => {
  const exchangeRequests: Array<Record<string, unknown>> = [];

  await page.route('**/api/auth/line/exchange', async (route) => {
    const requestBody = route.request().postDataJSON() as Record<string, unknown>;
    exchangeRequests.push(requestBody);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, saved: true }),
    });
  });

  await page.goto('http://127.0.0.1:3000/onboarding');

  await expect(page.getByRole('heading', { name: 'ตั้งค่าเป้าหมายของคุณ' })).toBeVisible();
  await page.getByLabel('เพศ').selectOption('female');
  await page.getByLabel('วันเกิด').fill('1996-08-25');
  await page.getByLabel('ส่วนสูง (ซม.)').fill('165');
  await page.getByLabel('น้ำหนักปัจจุบัน (กก.)').fill('60');
  await page.getByLabel('ระดับกิจกรรม').selectOption('moderate');
  await page.getByLabel('ประสบการณ์ฝึก').selectOption('beginner');
  await page.getByLabel('เป้าหมาย').selectOption('maintain');
  await page.getByLabel('น้ำหนักเป้าหมาย (กก.)').fill('60');
  await page.getByLabel('จำนวนวันฝึกต่อสัปดาห์ (วัน)').fill('3');

  await page.getByRole('button', { name: 'คำนวณเป้าหมาย' }).click();

  await expect(page.getByText('อายุ 30 ปี')).toBeVisible();
  await expect(page.getByText('BMR')).toBeVisible();
  await expect(page.getByText('TDEE')).toBeVisible();
  await expect(page.getByText('2,046 kcal')).toHaveCount(2);
  await expect(page.getByText('96 g')).toBeVisible();
  expect(exchangeRequests).toHaveLength(0);

  await page.getByLabel('ฉันตรวจสอบค่าด้านบนแล้วและยืนยันให้บันทึก').check();
  await page.getByRole('button', { name: 'ยืนยันและบันทึก' }).click();

  await expect.poll(() => exchangeRequests.length).toBe(1);
  expect(exchangeRequests[0]).toMatchObject({
    idToken: 'synthetic.e2e.id-token',
    confirmed: true,
    onboarding: {
      sex: 'female',
      birthDate: '1996-08-25',
      heightCm: 165,
      currentWeightKg: 60,
      activityLevel: 'moderate',
      experienceLevel: 'beginner',
      goalType: 'maintain',
      targetWeightKg: 60,
      trainingDaysPerWeek: 3,
    },
  });
  expect(exchangeRequests[0]).not.toHaveProperty('lineUserId');
});
