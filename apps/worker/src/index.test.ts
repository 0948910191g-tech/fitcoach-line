import { describe, expect, it } from 'vitest';

const VALID_FOOD_RESULT = {
  confidence: 0.91,
  assumptions: ['synthetic task 6 fixture'],
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
      name: 'Synthetic meal',
      quantity: { value: 200, unit: 'g' },
      components: [],
      caloriesKcal: 420,
      proteinG: 28,
      carbsG: 45,
      fatG: 14,
      sugarG: 6,
      sodiumMg: 700,
    },
  ],
  totals: {
    caloriesKcal: 420,
    proteinG: 28,
    carbsG: 45,
    fatG: 14,
    sugarG: 6,
    sodiumMg: 700,
  },
} as const;

async function loadSubject() {
  const modulePath: string = './index';
  const subject = await import(modulePath).catch(() => ({}));
  expect(subject.createAIWorker).toBeTypeOf('function');

  if (typeof subject.createAIWorker !== 'function') return null;
  return subject;
}

function createStore() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const job = {
    jobId: 'job-entrypoint',
    userId: 'user-entrypoint',
    taskType: 'line_text_ingestion',
    provider: 'fake',
    inputRef: 'synthetic:entrypoint',
    attempts: 0,
    leaseToken: 'lease-entrypoint',
    leaseExpiresAt: '2026-08-28T03:00:00.000Z',
    quotaUsed: 1,
  };

  return {
    calls,
    store: {
      async claim(...args: unknown[]) {
        calls.push({ name: 'claim', args });
        return job;
      },
      async beginAttempt(...args: unknown[]) {
        calls.push({ name: 'beginAttempt', args });
        return 1;
      },
      async complete(...args: unknown[]) {
        calls.push({ name: 'complete', args });
        return true;
      },
      async fail(...args: unknown[]) {
        calls.push({ name: 'fail', args });
        return true;
      },
    },
  };
}

function fakeProvider(foodOutput: unknown) {
  const unexpected = async () => {
    throw new Error('unexpected provider method');
  };

  return {
    analyzeFood: async () => foodOutput,
    parseWorkout: unexpected,
    generateCoachReply: unexpected,
    generateDailyReport: unexpected,
    generateWeeklyReport: unexpected,
  };
}

describe('worker entrypoint wiring', () => {
  it('routes a resolved job through AIProvider/AIRouter before durable completion', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore();
    let resolvedTaskType: string | undefined;

    const worker = subject.createAIWorker({
      workerId: 'entrypoint-worker',
      store,
      provider: fakeProvider(VALID_FOOD_RESULT),
      resolveExecution: async (job: { taskType: string }) => {
        resolvedTaskType = job.taskType;
        return {
          method: 'analyzeFood',
          input: { text: 'synthetic meal', locale: 'th-TH' },
        };
      },
    });

    const result = await worker.runOnce();

    expect(resolvedTaskType).toBe('line_text_ingestion');
    expect(result).toMatchObject({ status: 'completed', jobId: 'job-entrypoint', attempt: 1 });
    const completion = calls.find((call) => call.name === 'complete');
    expect(completion?.args[2]).toEqual(VALID_FOOD_RESULT);
    expect(calls.map((call) => call.name)).toEqual(['claim', 'beginAttempt', 'complete']);
  });

  it('never persists raw runtime-invalid provider output', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore();

    const worker = subject.createAIWorker({
      workerId: 'entrypoint-invalid',
      store,
      provider: fakeProvider('{ definitely-not-json'),
      resolveExecution: async () => ({
        method: 'analyzeFood',
        input: { text: 'synthetic meal' },
      }),
    });

    const result = await worker.runOnce();

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_json',
      attempt: 1,
    });
    expect(calls.some((call) => call.name === 'complete')).toBe(false);
    const failure = calls.find((call) => call.name === 'fail');
    expect(failure?.args[2]).toEqual({
      outcome: 'failed',
      errorCode: 'invalid_json',
      nextAttemptAt: null,
    });
  });

  it('passes the worker-owned AbortSignal through AIRouter into the provider', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store } = createStore();
    let resolveSignal: AbortSignal | undefined;
    let providerSignal: AbortSignal | undefined;
    const unexpected = async () => {
      throw new Error('unexpected provider method');
    };

    const worker = subject.createAIWorker({
      workerId: 'entrypoint-signal',
      store,
      provider: {
        analyzeFood: async (_input: unknown, context?: { signal?: AbortSignal }) => {
          providerSignal = context?.signal;
          return VALID_FOOD_RESULT;
        },
        parseWorkout: unexpected,
        generateCoachReply: unexpected,
        generateDailyReport: unexpected,
        generateWeeklyReport: unexpected,
      },
      resolveExecution: async (_job: unknown, signal: AbortSignal) => {
        resolveSignal = signal;
        return {
          method: 'analyzeFood',
          input: { text: 'synthetic meal', locale: 'th-TH' },
        };
      },
    });

    await worker.runOnce();

    expect(resolveSignal).toBeInstanceOf(AbortSignal);
    expect(providerSignal).toBe(resolveSignal);
  });
});
