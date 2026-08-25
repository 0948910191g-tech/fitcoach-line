import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const requiredEnv = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
] as const;
const hasIntegrationEnv = requiredEnv.every((key) => Boolean(process.env[key]));
const describeIntegration = hasIntegrationEnv ? describe : describe.skip;

function env(name: (typeof requiredEnv)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing integration environment: ${name}`);
  return value.replace(/^"|"$/g, '');
}

function serviceHeaders(): Record<string, string> {
  const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(new URL(path, env('SUPABASE_TEST_URL')), {
    ...init,
    headers: { ...serviceHeaders(), ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : []) as T };
}

async function createSyntheticUser(): Promise<string> {
  const userId = randomUUID();
  const inserted = await rest<unknown[]>('/rest/v1/users', {
    method: 'POST',
    body: JSON.stringify({
      id: userId,
      line_user_id: `U_SYNTHETIC_${userId.replaceAll('-', '')}`,
      status: 'active',
    }),
  });
  expect(inserted.status).toBe(201);
  return userId;
}

async function loadSubject() {
  const clientPath: string = '../client';
  const repositoryPath: string = './ai-job';
  const clientModule = await import(clientPath).catch(() => ({}));
  const repositoryModule = await import(repositoryPath).catch(() => ({}));
  expect(clientModule.createServiceDatabaseClient).toBeTypeOf('function');
  expect(repositoryModule.AIJobRepository).toBeTypeOf('function');
  if (
    typeof clientModule.createServiceDatabaseClient !== 'function' ||
    typeof repositoryModule.AIJobRepository !== 'function'
  ) {
    return null;
  }

  const client = clientModule.createServiceDatabaseClient({
    SUPABASE_URL: env('SUPABASE_TEST_URL'),
    SUPABASE_ANON_KEY: env('SUPABASE_TEST_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: env('SUPABASE_TEST_SERVICE_ROLE_KEY'),
  });
  const repository = new repositoryModule.AIJobRepository(client);
  expect(repository.ingestLineEvent).toBeTypeOf('function');
  if (typeof repository.ingestLineEvent !== 'function') return null;
  return repository;
}

function input(userId: string, providerEventId: string) {
  return {
    providerEventId,
    eventType: 'text',
    payloadHash: 'a'.repeat(64),
    userId,
    taskType: 'line_text_ingestion',
    inputRef: `line-event:${providerEventId}`,
  };
}

async function rows<T>(table: string, query: string): Promise<T[]> {
  const result = await rest<T[]>(`/rest/v1/${table}?${query}`);
  expect(result.status).toBe(200);
  return result.body;
}

describeIntegration('atomic LINE event ingestion', () => {
  it('rolls back webhook_event when ai_job creation fails', async () => {
    const repository = await loadSubject();
    if (!repository) return;
    const missingUserId = randomUUID();
    const eventId = `evt-rollback-${randomUUID()}`;

    await expect(repository.ingestLineEvent(input(missingUserId, eventId))).rejects.toThrow();

    expect(await rows('webhook_events', `provider_event_id=eq.${eventId}`)).toEqual([]);
    expect(await rows('ai_jobs', `input_ref=eq.line-event:${eventId}`)).toEqual([]);
  });

  it('creates only one webhook_event and one ai_job for duplicate delivery', async () => {
    const repository = await loadSubject();
    if (!repository) return;
    const userId = await createSyntheticUser();
    const eventId = `evt-duplicate-${randomUUID()}`;

    const first = await repository.ingestLineEvent(input(userId, eventId));
    const duplicate = await repository.ingestLineEvent(input(userId, eventId));

    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(await rows('webhook_events', `provider_event_id=eq.${eventId}`)).toHaveLength(1);
    expect(await rows('ai_jobs', `input_ref=eq.line-event:${eventId}`)).toHaveLength(1);
  });

  it('uses the unique provider event id as the concurrency barrier for simultaneous retries', async () => {
    const repository = await loadSubject();
    if (!repository) return;
    const userId = await createSyntheticUser();
    const eventId = `evt-concurrent-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.ingestLineEvent(input(userId, eventId))),
    );

    expect(results.filter((result: { inserted: boolean }) => result.inserted)).toHaveLength(1);
    expect(await rows('webhook_events', `provider_event_id=eq.${eventId}`)).toHaveLength(1);
    expect(await rows('ai_jobs', `input_ref=eq.line-event:${eventId}`)).toHaveLength(1);
  });

  it('does not expose the ingestion RPC to anon callers', async () => {
    const userId = randomUUID();
    const eventId = `evt-anon-${randomUUID()}`;
    const anonKey = env('SUPABASE_TEST_ANON_KEY');
    const response = await fetch(new URL('/rest/v1/rpc/ingest_line_event_v1', env('SUPABASE_TEST_URL')), {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_provider_event_id: eventId,
        p_event_type: 'text',
        p_payload_hash: 'b'.repeat(64),
        p_user_id: userId,
        p_task_type: 'line_text_ingestion',
        p_input_ref: `line-event:${eventId}`,
      }),
    });

    expect([401, 403, 404]).toContain(response.status);
    expect(await rows('webhook_events', `provider_event_id=eq.${eventId}`)).toEqual([]);
  });
});
