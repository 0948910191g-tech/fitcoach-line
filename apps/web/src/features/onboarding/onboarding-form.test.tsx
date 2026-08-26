import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const AUTH_USER_ID = '00000000-0000-4000-8000-000000000501';
const APP_USER_ID = '00000000-0000-4000-8000-000000000601';
const OTHER_AUTH_USER_ID = '00000000-0000-4000-8000-000000000502';
const VERIFIED_LINE_SUBJECT = 'U_SYNTHETIC_VERIFIED_SUBJECT';
const OTHER_LINE_SUBJECT = 'U_SYNTHETIC_OTHER_SUBJECT';
const CALLBACK_URL = 'https://fitcoach.invalid/api/auth/line/exchange';
const OAUTH_URL = 'https://supabase.invalid/auth/v1/authorize?provider=custom%3Aline';

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

type TrustedLineLink = {
  user_id: string;
  auth_user_id: string;
  provider: string;
  provider_id: string;
  line_user_id: string;
};

type AuthClient = {
  auth: {
    signInWithOAuth: (input: unknown) => Promise<{ data: { url: string | null }; error: null }>;
    exchangeCodeForSession: (code: string) => Promise<{ error: null }>;
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: null }>;
  };
  rpc: (
    name: string,
  ) => Promise<{ data: TrustedLineLink[] | null; error: { message: string } | null }>;
};

type CreateLineExchangeHandler = (dependencies: {
  callbackUrl: string;
  createClient: () => Promise<AuthClient>;
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
  return (await import(path)) as UnknownModule;
}

function requireFunction<T>(subject: UnknownModule, name: string): T {
  expect(subject[name], `${name} must be implemented`).toBeTypeOf('function');
  return subject[name] as T;
}

function createAuthClient(linkOverride: Partial<TrustedLineLink> = {}): AuthClient {
  const link: TrustedLineLink = {
    user_id: APP_USER_ID,
    auth_user_id: AUTH_USER_ID,
    provider: 'custom:line',
    provider_id: VERIFIED_LINE_SUBJECT,
    line_user_id: VERIFIED_LINE_SUBJECT,
    ...linkOverride,
  };

  return {
    auth: {
      signInWithOAuth: vi.fn(async () => ({ data: { url: OAUTH_URL }, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: AUTH_USER_ID } }, error: null })),
    },
    rpc: vi.fn(async () => ({ data: [link], error: null })),
  };
}

describe('LINE Custom OIDC exchange', () => {
  it('starts redirect login with custom:line and openid/profile scopes', async () => {
    const route = await loadModule('../../../app/api/auth/line/exchange/route');
    const createLineExchangeHandler = requireFunction<CreateLineExchangeHandler>(
      route,
      'createLineExchangeHandler',
    );
    const client = createAuthClient();
    const handler = createLineExchangeHandler({
      callbackUrl: CALLBACK_URL,
      createClient: vi.fn(async () => client),
    });

    const response = await handler(new Request(CALLBACK_URL));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'custom:line',
      options: {
        redirectTo: CALLBACK_URL,
        scopes: 'openid profile',
      },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(OAUTH_URL);
  });

  it('accepts callback only after a real Supabase user session and trusted custom:line link agree', async () => {
    const route = await loadModule('../../../app/api/auth/line/exchange/route');
    const createLineExchangeHandler = requireFunction<CreateLineExchangeHandler>(
      route,
      'createLineExchangeHandler',
    );
    const client = createAuthClient();
    const handler = createLineExchangeHandler({
      callbackUrl: CALLBACK_URL,
      createClient: vi.fn(async () => client),
    });

    const response = await handler(new Request(`${CALLBACK_URL}?code=synthetic-auth-code`));

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('synthetic-auth-code');
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('link_line_identity_v1');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://fitcoach.invalid/onboarding');
  });

  it.each([
    ['wrong provider', { provider: 'google' }],
    ['mismatched provider subject', { provider_id: OTHER_LINE_SUBJECT }],
    ['mismatched auth user', { auth_user_id: OTHER_AUTH_USER_ID }],
  ] as const)('rejects %s returned by identity linking', async (_caseName, override) => {
    const route = await loadModule('../../../app/api/auth/line/exchange/route');
    const createLineExchangeHandler = requireFunction<CreateLineExchangeHandler>(
      route,
      'createLineExchangeHandler',
    );
    const client = createAuthClient(override);
    const handler = createLineExchangeHandler({
      callbackUrl: CALLBACK_URL,
      createClient: vi.fn(async () => client),
    });

    const response = await handler(new Request(`${CALLBACK_URL}?code=synthetic-auth-code`));

    expect(response.status).toBe(401);
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

  it('derives age from birth date and calculates BMR, TDEE, calories and protein through domain rules', async () => {
    const service = await loadModule('../../services/onboarding-service');
    const calculateOnboardingPreview = requireFunction<CalculateOnboardingPreview>(
      service,
      'calculateOnboardingPreview',
    );

    expect(
      calculateOnboardingPreview(VALID_ONBOARDING, { asOfDate: '2026-08-25' }),
    ).toEqual({
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
  it('renders accessible Thai labels with metric units and an explicit confirmation control', async () => {
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
