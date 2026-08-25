import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const APP_USER_ID = '00000000-0000-4000-8000-000000000501';
const VERIFIED_SUBJECT = 'U_SYNTHETIC_VERIFIED_SUBJECT';
const CLIENT_FORGED_SUBJECT = 'U_SYNTHETIC_CLIENT_FORGED';
const SYNTHETIC_ID_TOKEN = 'synthetic.id.token';
const LINE_LOGIN_CHANNEL_ID = '1234567890';

const VALID_ONBOARDING = {
  sex: 'female',
  birthDate: '1996-08-25',
  heightCm: 165,
  currentWeightKg: 60,
  activityLevel: 'moderate',
  experienceLevel: 'beginner',
  goalType: 'maintain',
  targetWeightKg: 60,
  trainingDaysPerWeek: 3,
} as const;

type UnknownModule = Record<string, unknown>;

type VerifiedLineIdentity = {
  sub: string;
  name?: string;
  picture?: string;
};

type LineExchangeFactory = (dependencies: {
  lineLoginChannelId: string;
  verifyIdToken: (
    idToken: string,
    expectedChannelId: string,
  ) => Promise<VerifiedLineIdentity | null>;
  resolveUser: (identity: VerifiedLineIdentity) => Promise<{ id: string }>;
}) => (request: Request) => Promise<Response>;

type ValidateOnboardingInput = (input: unknown) => {
  valid: boolean;
  errors: Readonly<Record<string, string>>;
};

type CalculateOnboardingPreview = (
  input: typeof VALID_ONBOARDING,
  options?: { asOfDate?: string },
) => {
  ageYears: number;
  bmrKcal: number;
  tdeeKcal: number;
  targetCaloriesKcal: number;
  targetProteinG: number;
};

type CreateOnboardingService = (dependencies: {
  saveConfirmedOnboarding: (input: unknown) => Promise<void>;
}) => {
  save: (input: {
    userId: string;
    onboarding: typeof VALID_ONBOARDING;
    confirmed: boolean;
    asOfDate?: string;
  }) => Promise<unknown>;
};

async function loadModule(path: string): Promise<UnknownModule> {
  return import(path).catch(() => ({}));
}

function requireFunction<T>(subject: UnknownModule, name: string): T {
  expect(subject[name], `${name} must be implemented`).toBeTypeOf('function');
  return subject[name] as T;
}

async function postExchange(
  handler: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
): Promise<Response> {
  return handler(
    new Request('https://fitcoach.invalid/api/auth/line/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('LINE identity exchange', () => {
  it('maps only the verified LINE subject to the application user', async () => {
    const route = await loadModule('../../../app/api/auth/line/exchange/route');
    const createLineExchangeHandler = requireFunction<LineExchangeFactory>(
      route,
      'createLineExchangeHandler',
    );
    const verifyIdToken = vi.fn(async () => ({
      sub: VERIFIED_SUBJECT,
      name: 'Synthetic User',
      picture: 'https://example.invalid/synthetic-avatar.png',
    }));
    const resolveUser = vi.fn(async () => ({ id: APP_USER_ID }));
    const handler = createLineExchangeHandler({
      lineLoginChannelId: LINE_LOGIN_CHANNEL_ID,
      verifyIdToken,
      resolveUser,
    });

    const response = await postExchange(handler, {
      idToken: SYNTHETIC_ID_TOKEN,
      lineUserId: CLIENT_FORGED_SUBJECT,
    });

    expect(response.status).toBe(200);
    expect(verifyIdToken).toHaveBeenCalledWith(SYNTHETIC_ID_TOKEN, LINE_LOGIN_CHANNEL_ID);
    expect(resolveUser).toHaveBeenCalledWith(
      expect.objectContaining({ sub: VERIFIED_SUBJECT }),
    );
    expect(resolveUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ sub: CLIENT_FORGED_SUBJECT }),
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ authenticated: true, userId: APP_USER_ID }),
    );
  });

  it('rejects a forged or unverifiable ID token before user mapping', async () => {
    const route = await loadModule('../../../app/api/auth/line/exchange/route');
    const createLineExchangeHandler = requireFunction<LineExchangeFactory>(
      route,
      'createLineExchangeHandler',
    );
    const resolveUser = vi.fn(async () => ({ id: APP_USER_ID }));
    const handler = createLineExchangeHandler({
      lineLoginChannelId: LINE_LOGIN_CHANNEL_ID,
      verifyIdToken: vi.fn(async () => null),
      resolveUser,
    });

    const response = await postExchange(handler, { idToken: SYNTHETIC_ID_TOKEN });

    expect(response.status).toBe(401);
    expect(resolveUser).not.toHaveBeenCalled();
  });
});

describe('onboarding validation and target calculation', () => {
  it.each([
    'sex',
    'birthDate',
    'heightCm',
    'currentWeightKg',
    'activityLevel',
    'experienceLevel',
    'goalType',
    'targetWeightKg',
    'trainingDaysPerWeek',
  ] as const)('requires %s', async (field) => {
    const service = await loadModule('../../services/onboarding-service');
    const validateOnboardingInput = requireFunction<ValidateOnboardingInput>(
      service,
      'validateOnboardingInput',
    );
    const incomplete = { ...VALID_ONBOARDING } as Record<string, unknown>;
    delete incomplete[field];

    const result = validateOnboardingInput(incomplete);

    expect(result.valid).toBe(false);
    expect(result.errors[field]).toBeTruthy();
  });

  it('derives age from birth date and calculates BMR, TDEE, calories and protein through the domain rules', async () => {
    const service = await loadModule('../../services/onboarding-service');
    const calculateOnboardingPreview = requireFunction<CalculateOnboardingPreview>(
      service,
      'calculateOnboardingPreview',
    );

    const preview = calculateOnboardingPreview(VALID_ONBOARDING, {
      asOfDate: '2026-08-25',
    });

    expect(preview).toEqual({
      ageYears: 30,
      bmrKcal: 1320,
      tdeeKcal: 2046,
      targetCaloriesKcal: 2046,
      targetProteinG: 96,
    });
  });
});

describe('explicit onboarding confirmation', () => {
  it('does not persist profile or goal before explicit confirmation', async () => {
    const service = await loadModule('../../services/onboarding-service');
    const createOnboardingService = requireFunction<CreateOnboardingService>(
      service,
      'createOnboardingService',
    );
    const saveConfirmedOnboarding = vi.fn(async () => undefined);
    const onboardingService = createOnboardingService({ saveConfirmedOnboarding });

    await expect(
      onboardingService.save({
        userId: APP_USER_ID,
        onboarding: VALID_ONBOARDING,
        confirmed: false,
        asOfDate: '2026-08-25',
      }),
    ).rejects.toThrow(/confirm/i);
    expect(saveConfirmedOnboarding).not.toHaveBeenCalled();

    await onboardingService.save({
      userId: APP_USER_ID,
      onboarding: VALID_ONBOARDING,
      confirmed: true,
      asOfDate: '2026-08-25',
    });

    expect(saveConfirmedOnboarding).toHaveBeenCalledTimes(1);
    expect(saveConfirmedOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: APP_USER_ID,
        profile: expect.objectContaining({
          sex: 'female',
          birthDate: '1996-08-25',
          heightCm: 165,
          currentWeightKg: 60,
          activityLevel: 'moderate',
          experienceLevel: 'beginner',
        }),
        goal: expect.objectContaining({
          goalType: 'maintain',
          targetWeightKg: 60,
          targetCalories: 2046,
          targetProteinG: 96,
          trainingDaysPerWeek: 3,
        }),
      }),
    );
  });
});

describe('Thai mobile onboarding form', () => {
  it('renders accessible Thai labels with explicit metric units and confirmation control', async () => {
    const formModule = await loadModule('./onboarding-form');
    expect(formModule.OnboardingForm, 'OnboardingForm must be implemented').toBeTypeOf('function');
    if (typeof formModule.OnboardingForm !== 'function') return;

    const OnboardingForm = formModule.OnboardingForm as ComponentType;
    const html = renderToStaticMarkup(createElement(OnboardingForm));

    for (const label of [
      'เพศ',
      'วันเกิด',
      'ส่วนสูง (ซม.)',
      'น้ำหนักปัจจุบัน (กก.)',
      'ระดับกิจกรรม',
      'ประสบการณ์ฝึก',
      'เป้าหมาย',
      'น้ำหนักเป้าหมาย (กก.)',
      'จำนวนวันฝึกต่อสัปดาห์ (วัน)',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('ยืนยันและบันทึก');
    expect(html).toContain('เป็นค่าประมาณ');
    expect(html).toContain('ไม่ใช่คำวินิจฉัยทางการแพทย์');
  });
});
