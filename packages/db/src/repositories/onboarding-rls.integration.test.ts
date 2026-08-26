import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const requiredEnv = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_JWT_SECRET',
] as const;

const hasIntegrationEnv = requiredEnv.every((key) => Boolean(process.env[key]));

function env(name: (typeof requiredEnv)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing integration environment: ${name}`);
  return value.replace(/^"|"$/g, '');
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function createUserJwt(userId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      aud: 'authenticated',
      exp: now + 60 * 10,
      iat: now,
      role: 'authenticated',
      sub: userId,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

type Credential = { apiKey: string; bearer: string };

async function request<T>(
  path: string,
  init: RequestInit,
  credential: Credential,
): Promise<{ status: number; body: T }> {
  const response = await fetch(new URL(path, env('SUPABASE_TEST_URL')), {
    ...init,
    headers: {
      apikey: credential.apiKey,
      Authorization: `Bearer ${credential.bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ([] as T);
  } catch {
    body = text as T;
  }
  return { status: response.status, body };
}

async function createAuthUser(id: string, marker: string): Promise<void> {
  const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
  const result = await request<unknown>(
    '/auth/v1/admin/users',
    {
      method: 'POST',
      body: JSON.stringify({
        id,
        email: `${marker}@synthetic.invalid`,
        password: 'Synthetic-only-password-123!',
        email_confirm: true,
      }),
    },
    { apiKey: serviceRole, bearer: serviceRole },
  );
  expect([200, 201]).toContain(result.status);
}

const describeIntegration = hasIntegrationEnv ? describe : describe.skip;

describeIntegration('Task 5 auth bridge and onboarding RLS', () => {
  it('keeps app user ids separate from auth ids and isolates user A from user B health rows', async () => {
    const authA = randomUUID();
    const authB = randomUUID();
    const appA = randomUUID();
    const appB = randomUUID();
    await createAuthUser(authA, `a-${authA}`);
    await createAuthUser(authB, `b-${authB}`);

    const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_TEST_ANON_KEY');
    const jwtSecret = env('SUPABASE_TEST_JWT_SECRET');
    const service = { apiKey: serviceRole, bearer: serviceRole };
    const userA = { apiKey: anonKey, bearer: createUserJwt(authA, jwtSecret) };

    const users = await request<unknown[]>(
      '/rest/v1/users',
      {
        method: 'POST',
        body: JSON.stringify([
          { id: appA, line_user_id: `U_SYNTHETIC_A_${appA}`, auth_user_id: authA },
          { id: appB, line_user_id: `U_SYNTHETIC_B_${appB}`, auth_user_id: authB },
        ]),
      },
      service,
    );
    expect(users.status).toBe(201);
    expect(appA).not.toBe(authA);

    const metricA = randomUUID();
    const metricB = randomUUID();
    for (const row of [
      { id: metricA, user_id: appA, measured_at: '2026-08-26T00:00:00.000Z', weight_kg: 65 },
      { id: metricB, user_id: appB, measured_at: '2026-08-26T00:00:00.000Z', weight_kg: 75 },
    ]) {
      const inserted = await request<unknown[]>('/rest/v1/body_metrics', {
        method: 'POST',
        body: JSON.stringify(row),
      }, service);
      expect(inserted.status).toBe(201);
    }

    const own = await request<Array<{ id: string }>>(
      `/rest/v1/body_metrics?id=eq.${metricA}&select=id`,
      { method: 'GET' },
      userA,
    );
    expect(own.status).toBe(200);
    expect(own.body).toEqual([{ id: metricA }]);

    const other = await request<Array<{ id: string }>>(
      `/rest/v1/body_metrics?id=eq.${metricB}&select=id`,
      { method: 'GET' },
      userA,
    );
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);

    const updateOwn = await request<unknown[]>(
      `/rest/v1/body_metrics?id=eq.${metricA}`,
      { method: 'PATCH', body: JSON.stringify({ weight_kg: 66 }) },
      userA,
    );
    expect(updateOwn.status).toBe(200);
    expect(updateOwn.body).toHaveLength(1);

    const updateOther = await request<unknown[]>(
      `/rest/v1/body_metrics?id=eq.${metricB}`,
      { method: 'PATCH', body: JSON.stringify({ weight_kg: 76 }) },
      userA,
    );
    expect([200, 403]).toContain(updateOther.status);
    if (updateOther.status === 200) expect(updateOther.body).toEqual([]);
  });

  it('allows safe profile-field update but blocks direct identity-column mutation', async () => {
    const authA = randomUUID();
    const appA = randomUUID();
    await createAuthUser(authA, `columns-${authA}`);
    const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_TEST_ANON_KEY');
    const jwtSecret = env('SUPABASE_TEST_JWT_SECRET');
    const service = { apiKey: serviceRole, bearer: serviceRole };
    const userA = { apiKey: anonKey, bearer: createUserJwt(authA, jwtSecret) };

    expect(
      (
        await request('/rest/v1/users', {
          method: 'POST',
          body: JSON.stringify({
            id: appA,
            line_user_id: `U_SYNTHETIC_COLUMNS_${appA}`,
            auth_user_id: authA,
          }),
        }, service)
      ).status,
    ).toBe(201);

    const timezoneUpdate = await request<unknown[]>(
      `/rest/v1/users?id=eq.${appA}`,
      { method: 'PATCH', body: JSON.stringify({ timezone: 'Asia/Bangkok' }) },
      userA,
    );
    expect(timezoneUpdate.status).toBe(200);
    expect(timezoneUpdate.body).toHaveLength(1);

    const identityUpdate = await request<unknown>(
      `/rest/v1/users?id=eq.${appA}`,
      { method: 'PATCH', body: JSON.stringify({ line_user_id: 'U_SYNTHETIC_FORGED' }) },
      userA,
    );
    expect([401, 403]).toContain(identityUpdate.status);
  });

  it('rejects non-custom:line identity and does not accept forged provider parameters', async () => {
    const authA = randomUUID();
    const appA = randomUUID();
    await createAuthUser(authA, `identity-${authA}`);
    const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_TEST_ANON_KEY');
    const jwtSecret = env('SUPABASE_TEST_JWT_SECRET');
    const service = { apiKey: serviceRole, bearer: serviceRole };
    const userA = { apiKey: anonKey, bearer: createUserJwt(authA, jwtSecret) };

    const inserted = await request('/rest/v1/users', {
      method: 'POST',
      body: JSON.stringify({ id: appA, line_user_id: `U_SYNTHETIC_IDENTITY_${appA}` }),
    }, service);
    expect(inserted.status).toBe(201);

    const noTrustedLine = await request<unknown>(
      '/rest/v1/rpc/link_line_identity_v1',
      { method: 'POST', body: '{}' },
      userA,
    );
    expect(noTrustedLine.status).toBeGreaterThanOrEqual(400);

    const forgedParameter = await request<unknown>(
      '/rest/v1/rpc/link_line_identity_v1',
      {
        method: 'POST',
        body: JSON.stringify({ p_provider_id: `U_SYNTHETIC_IDENTITY_${appA}` }),
      },
      userA,
    );
    expect(forgedParameter.status).toBeGreaterThanOrEqual(400);

    const persisted = await request<Array<{ auth_user_id: string | null }>>(
      `/rest/v1/users?id=eq.${appA}&select=auth_user_id`,
      { method: 'GET' },
      service,
    );
    expect(persisted.body).toEqual([{ auth_user_id: null }]);
  });

  it('does not persist onboarding before explicit confirmation, then saves through user-session RLS', async () => {
    const authA = randomUUID();
    const appA = randomUUID();
    await createAuthUser(authA, `onboarding-${authA}`);
    const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_TEST_ANON_KEY');
    const jwtSecret = env('SUPABASE_TEST_JWT_SECRET');
    const service = { apiKey: serviceRole, bearer: serviceRole };
    const userA = { apiKey: anonKey, bearer: createUserJwt(authA, jwtSecret) };

    const inserted = await request('/rest/v1/users', {
      method: 'POST',
      body: JSON.stringify({
        id: appA,
        line_user_id: `U_SYNTHETIC_ONBOARDING_${appA}`,
        auth_user_id: authA,
      }),
    }, service);
    expect(inserted.status).toBe(201);

    const rpcBody = {
      p_confirmed: false,
      p_sex: 'female',
      p_birth_date: '1996-08-25',
      p_height_cm: 165,
      p_current_weight_kg: 60,
      p_activity_level: 'moderate',
      p_experience_level: 'beginner',
      p_goal_type: 'maintain',
      p_target_weight_kg: 60,
      p_target_calories: 2046,
      p_target_protein_g: 96,
      p_training_days_per_week: 3,
    };

    const unconfirmed = await request<unknown>(
      '/rest/v1/rpc/save_onboarding_v1',
      { method: 'POST', body: JSON.stringify(rpcBody) },
      userA,
    );
    expect(unconfirmed.status).toBeGreaterThanOrEqual(400);

    const beforeProfiles = await request<unknown[]>(
      `/rest/v1/profiles?user_id=eq.${appA}&select=id`,
      { method: 'GET' },
      service,
    );
    const beforeGoals = await request<unknown[]>(
      `/rest/v1/goals?user_id=eq.${appA}&select=id`,
      { method: 'GET' },
      service,
    );
    expect(beforeProfiles.body).toEqual([]);
    expect(beforeGoals.body).toEqual([]);

    const confirmed = await request<string>(
      '/rest/v1/rpc/save_onboarding_v1',
      { method: 'POST', body: JSON.stringify({ ...rpcBody, p_confirmed: true }) },
      userA,
    );
    expect(confirmed.status).toBe(200);

    const ownProfile = await request<Array<{ user_id: string; sex: string }>>(
      `/rest/v1/profiles?user_id=eq.${appA}&select=user_id,sex`,
      { method: 'GET' },
      userA,
    );
    const ownGoal = await request<Array<{ user_id: string; target_calories: number }>>(
      `/rest/v1/goals?user_id=eq.${appA}&select=user_id,target_calories`,
      { method: 'GET' },
      userA,
    );
    expect(ownProfile.body).toEqual([{ user_id: appA, sex: 'female' }]);
    expect(ownGoal.body).toEqual([{ user_id: appA, target_calories: 2046 }]);
  });
});
