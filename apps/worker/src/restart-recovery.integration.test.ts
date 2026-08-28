import { beforeEach, describe, expect, it } from 'vitest';
import { createSupabaseAIJobStore } from './process-job';

type RuntimeProcess = { env: Readonly<Record<string, string | undefined>> };
const runtimeProcess = (globalThis as typeof globalThis & { process?: RuntimeProcess }).process;
const runtimeEnv = runtimeProcess?.env ?? {};
const requiredEnv = ['SUPABASE_TEST_URL', 'SUPABASE_TEST_SERVICE_ROLE_KEY'] as const;
const hasIntegrationEnv = requiredEnv.every((key) => Boolean(runtimeEnv[key]));
const describeIntegration = hasIntegrationEnv ? describe : describe.skip;
const randomUUID: () => string = () => crypto.randomUUID();

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

async function clearAIJobs(): Promise<void> {
  const result = await rest<unknown[]>('/rest/v1/ai_jobs?id=not.is.null', { method: 'DELETE' });
  expect(result.status).toBe(200);
}

async function createSyntheticUser(): Promise<string> {
  const userId = randomUUID();
  const result = await rest<unknown[]>('/rest/v1/users', {
    method: 'POST',
    body: JSON.stringify({
      id: userId,
      line_user_id: `U_TASK6_RESTART_${userId.replaceAll('-', '')}`,
      status: 'active',
    }),
  });
  expect(result.status).toBe(201);
  return userId;
}

async function createQueuedJob(userId: string): Promise<string> {
  const result = await rest<Array<{ id: string }>>('/rest/v1/ai_jobs', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      task_type: 'line_text_ingestion',
      provider: 'fake',
      status: 'queued',
      input_ref: `synthetic-restart:${randomUUID()}`,
    }),
  });
  expect(result.status).toBe(201);
  const row = result.body[0];
  if (!row) throw new Error('Synthetic restart job insert returned no row');
  return row.id;
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

describeIntegration('full worker restart recovery', () => {
  beforeEach(async () => {
    await clearAIJobs();
  });

  it('recovers an in-flight process-job after lease expiry without double quota and fences the stale worker', async () => {
    const indexPath: string = './index';
    const subject = await import(indexPath).catch(() => ({}));
    expect(subject.createAIWorker).toBeTypeOf('function');
    if (typeof subject.createAIWorker !== 'function') return;

    const userId = await createSyntheticUser();
    const jobId = await createQueuedJob(userId);
    const store = createSupabaseAIJobStore({
      url: env('SUPABASE_TEST_URL'),
      serviceRoleKey: env('SUPABASE_TEST_SERVICE_ROLE_KEY'),
    });
    const firstProviderStarted = deferred<void>();
    const releaseFirstProvider = deferred<unknown>();
    const resolveExecution = async () => ({
      method: 'analyzeFood',
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

    const workerA = subject.createAIWorker({
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

    const workerB = subject.createAIWorker({
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
