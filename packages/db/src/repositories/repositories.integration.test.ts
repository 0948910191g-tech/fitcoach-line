import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const requiredEnv = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_JWT_SECRET',
] as const;

const hasIntegrationEnv = requiredEnv.every((key) => Boolean(process.env[key]));

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

function env(name: (typeof requiredEnv)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing integration environment: ${name}`);
  }
  return value.replace(/^"|"$/g, '');
}

async function restRequest<T>(
  table: string,
  init: RequestInit & { query?: string },
  credential: { apiKey: string; bearer: string },
): Promise<{ status: number; body: T }> {
  const url = new URL(`/rest/v1/${table}`, env('SUPABASE_TEST_URL'));
  if (init.query) url.search = init.query;

  const response = await fetch(url, {
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
  const body = text ? (JSON.parse(text) as T) : ([] as T);
  return { status: response.status, body };
}

const describeIntegration = hasIntegrationEnv ? describe : describe.skip;

describeIntegration('health data repositories RLS', () => {
  it('prevents user A from selecting or updating user B health rows', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_TEST_ANON_KEY');
    const jwtSecret = env('SUPABASE_TEST_JWT_SECRET');
    const serviceCredential = { apiKey: serviceRole, bearer: serviceRole };
    const userACredential = { apiKey: anonKey, bearer: createUserJwt(userA, jwtSecret) };

    const users = await restRequest<unknown[]>('users', {
      method: 'POST',
      body: JSON.stringify([
        { id: userA, line_user_id: `U-${userA}`, status: 'active' },
        { id: userB, line_user_id: `U-${userB}`, status: 'active' },
      ]),
    }, serviceCredential);
    expect(users.status).toBe(201);

    const fixtures = [
      { table: 'food_logs', row: { id: randomUUID(), user_id: userB, eaten_at: new Date().toISOString(), source: 'text', status: 'confirmed', confidence: 0.9 } },
      { table: 'workout_sessions', row: { id: randomUUID(), user_id: userB, started_at: new Date().toISOString(), workout_type: 'strength', status: 'confirmed' } },
      { table: 'body_metrics', row: { id: randomUUID(), user_id: userB, measured_at: new Date().toISOString(), weight_kg: 70 } },
      { table: 'recovery_logs', row: { id: randomUUID(), user_id: userB, logged_for: '2026-08-25', sleep_hours: 7 } },
      { table: 'coach_reports', row: { id: randomUUID(), user_id: userB, report_type: 'daily', period_start: '2026-08-25', period_end: '2026-08-25', facts_json: {}, report_json: {} } },
      { table: 'progress_photos', row: { id: randomUUID(), user_id: userB, captured_at: new Date().toISOString(), storage_path: `progress/${userB}/front.jpg`, pose: 'front' } },
    ] as const;

    for (const fixture of fixtures) {
      const inserted = await restRequest<unknown[]>(fixture.table, {
        method: 'POST',
        body: JSON.stringify(fixture.row),
      }, serviceCredential);
      expect(inserted.status, `${fixture.table} fixture insert`).toBe(201);

      const selected = await restRequest<unknown[]>(fixture.table, {
        method: 'GET',
        query: `id=eq.${fixture.row.id}`,
      }, userACredential);
      expect(selected.status, `${fixture.table} select status`).toBe(200);
      expect(selected.body, `${fixture.table} must be invisible to user A`).toEqual([]);

      const updated = await restRequest<unknown[]>(fixture.table, {
        method: 'PATCH',
        query: `id=eq.${fixture.row.id}`,
        body: JSON.stringify({ updated_at: new Date('2026-08-25T00:00:00.000Z').toISOString() }),
      }, userACredential);
      expect(updated.status, `${fixture.table} update status`).toBe(200);
      expect(updated.body, `${fixture.table} must not be writable by user A`).toEqual([]);
    }
  });
});
