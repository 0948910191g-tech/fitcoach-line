import { beforeEach, describe, expect, it } from 'vitest';
import { createAIWorker } from './index';
import { createSupabaseAIJobStore, processNextAIJob } from './process-job';

type RuntimeProcess = { env: Readonly<Record<string, string | undefined>> };
const runtimeProcess = (globalThis as typeof globalThis & { process?: RuntimeProcess }).process;
const runtimeEnv = runtimeProcess?.env ?? {};
const randomUUID: () => string = () => crypto.randomUUID();

const requiredEnv = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
] as const;
const hasIntegrationEnv = requiredEnv.every((key) => Boolean(runtimeEnv[key]));
const describeIntegration = hasIntegrationEnv ? describe : describe.skip;

const VALID_FOOD_RESULT = {
  confidence: 0.93,
  assumptions: ['synthetic restart fixture'],
  normalizedUnits: {
    mass: 'g',
    energy: 'kcal',
    protein: 'g',
    carbs: 'g',
    fat: 'g',
    sugar: 'g',
    sodium: 'mg',
  },
  items: [
    {
      name: 'Restart meal',
      quantity: { value: 180, unit: 'g' },
      components: [],
      caloriesKcal: 390,
      proteinG: 30,
      carbsG: 40,
      fatG: 12,
      sugarG: 4,
      sodiumMg: 650,
    },
  ],
  totals: {
    caloriesKcal: 390,
    proteinG: 30,
    carbsG: 40,
    fatG: 12,
    sugarG: 4,
    sodiumMg: 650,
  },
} as const;

function env(name: (typeof requiredEnv)[number]): string {
  const value = runtimeEnv[name];
  if (!value) throw new Error(`Missing integration environment: ${name}`);
  return value.replace(/^"|"$/g, '');
}

function serviceHeaders(): Record<string, string> {
  const serviceRole = env('SUPABASE_TEST_SERVICE_ROLE_KEY');
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    Accept: 'application/json',
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
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await rest<T>(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`RPC ${name} failed with HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function clearAIJobs(): Promise<void> {
  const result = await rest<unknown[]>('/rest/v1/ai_jobs?id=not.is.null', {
    method: 'DELETE',
  });
  expect(result.status).toBe(200);
}

async function createSyntheticUser(): Promise<string> {
  const userId = randomUUID();
  const result = await rest<unknown[]>('/rest/v1/users', {
    method: 'POST',
    body: JSON.stringify({
      id: userId,
      line_user_id: `U_TASK6_${userId.replaceAll('-', '')}`,
      status: 'active',
    }),
  });
  expect(result.status).toBe(201);
  return userId;
}

async function createQueuedJob(userId: string, suffix: string = randomUUID()): Promise<string> {
  const result = await rest<Array<{ id: string }>>('/rest/v1/ai_jobs', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      task_type: 'line_text_ingestion',
      provider: 'fake',
      status: 'queued',
      input_ref: `synthetic-task6:${suffix}`,
    }),
  });
  expect(result.status).toBe(201);
  const row = result.body[0];
  if (!row) throw new Error('Synthetic job insert returned no row');
  return row.id;
}

interface ClaimedJob {
  job_id: string;
  user_id: string;
  task_type: string;
  provider: string;
  input_ref: string | null;
  attempts: number;
  lease_token: string;
  lease_expires_at: string;
  quota_used: number;
}

async function claim(
  workerId: string,
  options: { leaseSeconds?: number; dailyLimit?: number; concurrencyLimit?: number } = {},
): Promise<ClaimedJob | null> {
  const rows = await rpc<ClaimedJob[]>('claim_ai_job_v1', {
    p_worker_id: workerId,
    p_lease_seconds: options.leaseSeconds ?? 30,
    p_daily_limit: options.dailyLimit ?? 50,
    p_concurrency_limit: options.concurrencyLimit ?? 1,
  });
  return rows[0] ?? null;
}

async function beginAttempt(jobId: string, leaseToken: string): Promise<number | null> {
  return rpc<number | null>('begin_ai_job_attempt_v1', {
    p_job_id: jobId,
    p_lease_token: leaseToken,
  });
}

async function finishFailure(
  jobId: string,
  leaseToken: string,
  outcome: 'retry_wait' | 'failed' | 'dead_letter',
  errorCode: string,
  nextAttemptAt: string | null = null,
): Promise<boolean> {
  return rpc<boolean>('fail_ai_job_attempt_v1', {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_next_attempt_at: nextAttemptAt,
  });
}

async function complete(jobId: string, leaseToken: string, marker: string): Promise<boolean> {
  return rpc<boolean>('complete_ai_job_v1', {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_output_json: { marker },
  });
}

async function getJob(jobId: string): Promise<Record<string, unknown>> {
  const result = await rest<Record<string, unknown>[]>(
    `/rest/v1/ai_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`,
  );
  expect(result.status).toBe(200);
  const row = result.body[0];
  if (!row) throw new Error(`Job ${jobId} not found`);
  return row;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeProvider(foodOutput: () => Promise<unknown>) {
  const unexpected = async () => {
    throw new Error('unexpected provider method');
  };

  return {
    analyzeFood: foodOutput,
    parseWorkout: unexpected,
    generateCoachReply: unexpected,
    generateDailyReport: unexpected,
    generateWeeklyReport: unexpected,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeIntegration('durable AI worker lease', () => {
  beforeEach(async () => {
    await clearAIJobs();
  });

  it('atomically gives one queued job to only one of two concurrent workers', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId);

    const [first, second] = await Promise.all([
      claim(`worker-a-${randomUUID()}`),
      claim(`worker-b-${randomUUID()}`),
    ]);
    const claims = [first, second].filter((value): value is ClaimedJob => value !== null);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.job_id).toBe(jobId);
    expect(claims[0]?.lease_token).toBeTruthy();
  });

  it('recovers the same job after its lease expires, simulating worker restart', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId);

    const crashedWorker = await claim(`crashed-${randomUUID()}`, { leaseSeconds: 1 });
    expect(crashedWorker?.job_id).toBe(jobId);

    await sleep(1_150);

    const restartedWorker = await claim(`restarted-${randomUUID()}`, { leaseSeconds: 30 });
    expect(restartedWorker?.job_id).toBe(jobId);
    expect(restartedWorker?.lease_token).not.toBe(crashedWorker?.lease_token);
  });

  it('rejects stale completion after lease loss and creates one terminal result only', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId);

    const stale = await claim(`stale-${randomUUID()}`, { leaseSeconds: 1 });
    expect(stale).not.toBeNull();
    await sleep(1_150);

    const owner = await claim(`owner-${randomUUID()}`, { leaseSeconds: 30 });
    expect(owner?.job_id).toBe(jobId);
    if (!stale || !owner) throw new Error('Expected both lease generations');

    expect(await complete(jobId, stale.lease_token, 'stale-result')).toBe(false);
    expect(await complete(jobId, owner.lease_token, 'confirmed-result')).toBe(true);
    expect(await complete(jobId, owner.lease_token, 'duplicate-result')).toBe(false);

    const stored = await getJob(jobId);
    expect(stored.status).toBe('completed');
    expect(stored.output_json).toEqual({ marker: 'confirmed-result' });
  });

  it('enforces Owner Alpha concurrency one until the active lease is released', async () => {
    const userId = await createSyntheticUser();
    const firstJobId = await createQueuedJob(userId, 'first');
    const secondJobId = await createQueuedJob(userId, 'second');

    const first = await claim(`worker-1-${randomUUID()}`);
    expect(first?.job_id).toBe(firstJobId);
    expect(await claim(`worker-2-${randomUUID()}`)).toBeNull();
    if (!first) throw new Error('Expected first lease');

    expect(await complete(first.job_id, first.lease_token, 'first-done')).toBe(true);
    const second = await claim(`worker-2-${randomUUID()}`);
    expect(second?.job_id).toBe(secondJobId);
  });

  it('counts a new job against daily quota once, not again when an expired lease is recovered', async () => {
    const userId = await createSyntheticUser();
    const firstJobId = await createQueuedJob(userId, 'quota-first');

    const firstLease = await claim(`quota-a-${randomUUID()}`, {
      leaseSeconds: 1,
      dailyLimit: 1,
    });
    expect(firstLease?.job_id).toBe(firstJobId);
    expect(firstLease?.quota_used).toBe(1);

    await sleep(1_150);
    const recovered = await claim(`quota-b-${randomUUID()}`, {
      leaseSeconds: 30,
      dailyLimit: 1,
    });
    expect(recovered?.job_id).toBe(firstJobId);
    expect(recovered?.quota_used).toBe(1);
    if (!recovered) throw new Error('Expected recovered lease');
    expect(await complete(firstJobId, recovered.lease_token, 'quota-first-done')).toBe(true);

    await createQueuedJob(userId, 'quota-blocked');
    expect(
      await claim(`quota-c-${randomUUID()}`, {
        dailyLimit: 1,
      }),
    ).toBeNull();
  });

  it('counts provider attempts before execution and persists exponential retry states through attempt three', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId, 'retry-durable');

    const first = await claim(`retry-a-${randomUUID()}`);
    expect(first?.attempts).toBe(0);
    if (!first) throw new Error('Expected first claim');
    expect(await beginAttempt(jobId, first.lease_token)).toBe(1);
    expect(
      await finishFailure(
        jobId,
        first.lease_token,
        'retry_wait',
        'provider_temporary_failure',
        new Date(Date.now() + 20).toISOString(),
      ),
    ).toBe(true);

    await sleep(40);
    const second = await claim(`retry-b-${randomUUID()}`);
    expect(second?.attempts).toBe(1);
    if (!second) throw new Error('Expected second claim');
    expect(await beginAttempt(jobId, second.lease_token)).toBe(2);
    expect(
      await finishFailure(
        jobId,
        second.lease_token,
        'retry_wait',
        'provider_temporary_failure',
        new Date(Date.now() + 40).toISOString(),
      ),
    ).toBe(true);

    await sleep(60);
    const third = await claim(`retry-c-${randomUUID()}`);
    expect(third?.attempts).toBe(2);
    if (!third) throw new Error('Expected third claim');
    expect(await beginAttempt(jobId, third.lease_token)).toBe(3);
    expect(
      await finishFailure(jobId, third.lease_token, 'dead_letter', 'provider_temporary_failure'),
    ).toBe(true);

    const stored = await getJob(jobId);
    expect(stored.status).toBe('dead_letter');
    expect(stored.attempts).toBe(3);
    expect(stored.error_code).toBe('provider_temporary_failure');
    expect(stored.finished_at).toBeTruthy();
    expect(await claim(`retry-d-${randomUUID()}`)).toBeNull();
  });

  it('makes permanent failure terminal after one provider attempt without retry', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId, 'permanent');
    const owner = await claim(`permanent-${randomUUID()}`);
    if (!owner) throw new Error('Expected permanent-error claim');

    expect(await beginAttempt(jobId, owner.lease_token)).toBe(1);
    expect(
      await finishFailure(jobId, owner.lease_token, 'failed', 'schema_mismatch'),
    ).toBe(true);

    const stored = await getJob(jobId);
    expect(stored.status).toBe('failed');
    expect(stored.attempts).toBe(1);
    expect(stored.error_code).toBe('schema_mismatch');
    expect(stored.next_attempt_at).toBeNull();
    expect(stored.finished_at).toBeTruthy();
    expect(await claim(`permanent-retry-${randomUUID()}`)).toBeNull();
  });

  it('runs the production worker store and completion path against disposable Supabase', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId, 'production-store');
    const store = createSupabaseAIJobStore({
      url: env('SUPABASE_TEST_URL'),
      serviceRoleKey: env('SUPABASE_TEST_SERVICE_ROLE_KEY'),
    });

    const result = await processNextAIJob({
      workerId: `runtime-${randomUUID()}`,
      store,
      execute: async (job, signal) => {
        expect(job.jobId).toBe(jobId);
        expect(signal.aborted).toBe(false);
        return { marker: 'runtime-confirmed' };
      },
    });

    expect(result).toMatchObject({ status: 'completed', jobId, attempt: 1, quotaUsed: 1 });
    const stored = await getJob(jobId);
    expect(stored.status).toBe('completed');
    expect(stored.attempts).toBe(1);
    expect(stored.output_json).toEqual({ marker: 'runtime-confirmed' });
    expect(stored.lease_token).toBeNull();
    expect(stored.finished_at).toBeTruthy();
  });

  it('recovers an in-flight process-job after lease expiry without double quota and fences the stale worker', async () => {
    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId, 'full-restart');
    const store = createSupabaseAIJobStore({
      url: env('SUPABASE_TEST_URL'),
      serviceRoleKey: env('SUPABASE_TEST_SERVICE_ROLE_KEY'),
    });
    const firstProviderStarted = deferred<void>();
    const releaseFirstProvider = deferred<unknown>();
    const resolveExecution = async () => ({
      method: 'analyzeFood' as const,
      input: { text: 'synthetic restart meal', locale: 'th-TH' },
    });
    const policy = {
      dailyLimit: 50,
      warningAt: 40,
      concurrencyLimit: 1,
      timeoutMs: 10_000,
      maxProviderAttempts: 3,
      retryBaseDelayMs: 1,
      leaseSeconds: 1,
    };

    const workerA = createAIWorker({
      workerId: `restart-a-${randomUUID()}`,
      store,
      provider: fakeProvider(async () => {
        firstProviderStarted.resolve();
        return releaseFirstProvider.promise;
      }),
      resolveExecution,
      policy,
    });

    const firstRunPromise = workerA.runOnce();
    await firstProviderStarted.promise;
    await sleep(1_150);

    const workerB = createAIWorker({
      workerId: `restart-b-${randomUUID()}`,
      store,
      provider: fakeProvider(async () => VALID_FOOD_RESULT),
      resolveExecution,
      policy: { ...policy, leaseSeconds: 30 },
    });

    const secondResult = await workerB.runOnce();
    expect(secondResult).toMatchObject({
      status: 'completed',
      jobId,
      attempt: 2,
      quotaUsed: 1,
    });

    releaseFirstProvider.resolve(VALID_FOOD_RESULT);
    const firstResult = await firstRunPromise;
    expect(firstResult).toMatchObject({ status: 'stale_lease', jobId, attempt: 1 });

    const stored = await getJob(jobId);
    expect(stored.status).toBe('completed');
    expect(stored.attempts).toBe(2);
    expect(stored.output_json).toEqual(VALID_FOOD_RESULT);
    expect(stored.quota_counted_at).toBeTruthy();
    expect(stored.lease_token).toBeNull();
  });
});
