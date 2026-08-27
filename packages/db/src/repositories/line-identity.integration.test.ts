import { execFile as execFileCallback } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

const requiredEnv = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_JWT_SECRET',
  'SUPABASE_TEST_DB_CONTAINER',
] as const;

const hasIntegrationEnv = requiredEnv.every((key) => Boolean(process.env[key]));
const describeIntegration = hasIntegrationEnv ? describe : describe.skip;

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

async function createAuthUser(userId: string, marker: string): Promise<void> {
  const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
  const result = await request<unknown>(
    '/auth/v1/admin/users',
    {
      method: 'POST',
      body: JSON.stringify({
        id: userId,
        email: `${marker}@synthetic.invalid`,
        password: 'Synthetic-only-password-123!',
        email_confirm: true,
      }),
    },
    { apiKey: serviceRole, bearer: serviceRole },
  );
  expect([200, 201]).toContain(result.status);
}

async function createAppUser(
  appUserId: string,
  lineUserId: string,
  authUserId?: string,
): Promise<void> {
  const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
  const result = await request<unknown[]>(
    '/rest/v1/users',
    {
      method: 'POST',
      body: JSON.stringify({
        id: appUserId,
        line_user_id: lineUserId,
        ...(authUserId ? { auth_user_id: authUserId } : {}),
      }),
    },
    { apiKey: serviceRole, bearer: serviceRole },
  );
  expect(result.status).toBe(201);
}

async function insertSyntheticIdentity(
  authUserId: string,
  provider: 'custom:line' | 'custom:line-oauth',
  lineSubject: string,
): Promise<void> {
  const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const sql = `
    insert into auth.identities (
      user_id,
      identity_data,
      provider,
      provider_id,
      created_at,
      updated_at
    )
    values (
      ${sqlString(authUserId)}::uuid,
      jsonb_build_object('sub', ${sqlString(lineSubject)}, 'provider_id', ${sqlString(lineSubject)}),
      ${sqlString(provider)},
      ${sqlString(lineSubject)},
      now(),
      now()
    );
  `;
  await execFile(
    'docker',
    [
      'exec',
      env('SUPABASE_TEST_DB_CONTAINER'),
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

async function linkIdentity(authUserId: string): Promise<{ status: number; body: unknown }> {
  const anonKey = env('SUPABASE_TEST_ANON_KEY');
  return request<unknown>(
    '/rest/v1/rpc/link_line_identity_v1',
    { method: 'POST', body: '{}' },
    { apiKey: anonKey, bearer: createUserJwt(authUserId, env('SUPABASE_TEST_JWT_SECRET')) },
  );
}

async function readAppUser(appUserId: string): Promise<Array<{ auth_user_id: string | null }>> {
  const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
  const result = await request<Array<{ auth_user_id: string | null }>>(
    `/rest/v1/users?id=eq.${appUserId}&select=auth_user_id`,
    { method: 'GET' },
    { apiKey: serviceRole, bearer: serviceRole },
  );
  expect(result.status).toBe(200);
  return result.body;
}

describeIntegration('trusted LINE identity bridge', () => {
  it('maps auth.uid through auth.identities to the matching app user', async () => {
    const authUserId = randomUUID();
    const appUserId = randomUUID();
    const lineSubject = `U_SYNTHETIC_TRUSTED_${appUserId}`;

    await createAuthUser(authUserId, `trusted-${authUserId}`);
    await createAppUser(appUserId, lineSubject);
    await insertSyntheticIdentity(authUserId, 'custom:line-oauth', lineSubject);

    const linked = await linkIdentity(authUserId);

    expect(linked.status).toBe(200);
    expect(linked.body).toEqual([
      {
        user_id: appUserId,
        auth_user_id: authUserId,
        provider: 'custom:line-oauth',
        provider_id: lineSubject,
        line_user_id: lineSubject,
      },
    ]);
    await expect(readAppUser(appUserId)).resolves.toEqual([{ auth_user_id: authUserId }]);
  });

  it('rejects the legacy custom:line provider even when its subject matches', async () => {
    const authUserId = randomUUID();
    const appUserId = randomUUID();
    const lineSubject = `U_SYNTHETIC_LEGACY_${appUserId}`;

    await createAuthUser(authUserId, `legacy-${authUserId}`);
    await createAppUser(appUserId, lineSubject);
    await insertSyntheticIdentity(authUserId, 'custom:line', lineSubject);

    const linked = await linkIdentity(authUserId);

    expect(linked.status).toBeGreaterThanOrEqual(400);
    await expect(readAppUser(appUserId)).resolves.toEqual([{ auth_user_id: null }]);
  });

  it('rejects linking another auth user to a LINE subject already owned by the app user', async () => {
    const authUserId = randomUUID();
    const existingAuthUserId = randomUUID();
    const appUserId = randomUUID();
    const lineSubject = `U_SYNTHETIC_OWNED_${appUserId}`;

    await createAuthUser(authUserId, `attacker-${authUserId}`);
    await createAuthUser(existingAuthUserId, `owner-${existingAuthUserId}`);
    await createAppUser(appUserId, lineSubject, existingAuthUserId);
    await insertSyntheticIdentity(authUserId, 'custom:line-oauth', lineSubject);

    const linked = await linkIdentity(authUserId);

    expect(linked.status).toBeGreaterThanOrEqual(400);
    await expect(readAppUser(appUserId)).resolves.toEqual([
      { auth_user_id: existingAuthUserId },
    ]);
  });
});
