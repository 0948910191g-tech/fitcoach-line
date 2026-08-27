import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './process-job';
  const subject = await import(modulePath).catch(() => ({}));

  expect(subject.OWNER_ALPHA_WORKER_POLICY).toMatchObject({
    dailyLimit: 50,
    warningAt: 40,
    concurrencyLimit: 1,
    timeoutMs: 90_000,
    maxProviderAttempts: 3,
  });
  expect(subject.processNextAIJob).toBeTypeOf('function');
  expect(subject.createSupabaseAIJobStore).toBeTypeOf('function');

  if (
    typeof subject.processNextAIJob !== 'function' ||
    typeof subject.createSupabaseAIJobStore !== 'function' ||
    !subject.OWNER_ALPHA_WORKER_POLICY
  ) {
    return null;
  }

  return subject;
}

function createStore(options: {
  attempts?: number;
  quotaUsed?: number;
  beginAttempt?: number | null;
  complete?: boolean;
} = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const claim = {
    jobId: 'job-1',
    userId: 'user-1',
    taskType: 'line_text_ingestion',
    provider: 'fake',
    inputRef: 'synthetic:1',
    attempts: options.attempts ?? 0,
    leaseToken: 'lease-1',
    leaseExpiresAt: '2026-08-27T15:00:00.000Z',
    quotaUsed: options.quotaUsed ?? 1,
  };

  return {
    calls,
    store: {
      async claim(...args: unknown[]) {
        calls.push({ name: 'claim', args });
        return claim;
      },
      async beginAttempt(...args: unknown[]) {
        calls.push({ name: 'beginAttempt', args });
        return options.beginAttempt === undefined ? claim.attempts + 1 : options.beginAttempt;
      },
      async complete(...args: unknown[]) {
        calls.push({ name: 'complete', args });
        return options.complete ?? true;
      },
      async fail(...args: unknown[]) {
        calls.push({ name: 'fail', args });
        return true;
      },
    },
  };
}

function policy(overrides: Record<string, number> = {}) {
  return {
    dailyLimit: 50,
    warningAt: 40,
    concurrencyLimit: 1,
    timeoutMs: 90_000,
    maxProviderAttempts: 3,
    retryBaseDelayMs: 1_000,
    leaseSeconds: 120,
    ...overrides,
  };
}

describe('Owner Alpha durable worker policy', () => {
  it('stores a successful validated result after counting the provider attempt', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore({ quotaUsed: 40 });
    const warnings: unknown[] = [];

    const result = await subject.processNextAIJob({
      workerId: 'worker-a',
      store,
      policy: policy(),
      now: () => new Date('2026-08-27T14:00:00.000Z'),
      onQuotaWarning: (warning: unknown) => warnings.push(warning),
      execute: async () => ({ confidence: 0.9, assumptions: ['synthetic'] }),
    });

    expect(result).toMatchObject({ status: 'completed', attempt: 1, quotaUsed: 40 });
    expect(warnings).toEqual([{ used: 40, limit: 50 }]);
    expect(calls.map((call) => call.name)).toEqual(['claim', 'beginAttempt', 'complete']);
    expect(calls[0]?.args[1]).toMatchObject({ dailyLimit: 50, concurrencyLimit: 1 });
  });

  it('uses exponential retry delay for retryable failures before the third provider attempt', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore({ attempts: 1, beginAttempt: 2 });
    const temporary = Object.assign(new Error('temporary'), {
      code: 'provider_temporary_failure',
      retryable: true,
    });

    const result = await subject.processNextAIJob({
      workerId: 'worker-b',
      store,
      policy: policy({ retryBaseDelayMs: 2_000 }),
      now: () => new Date('2026-08-27T14:00:00.000Z'),
      execute: async () => Promise.reject(temporary),
    });

    expect(result).toMatchObject({ status: 'retry_wait', attempt: 2 });
    const failure = calls.find((call) => call.name === 'fail');
    expect(failure?.args[2]).toEqual({
      outcome: 'retry_wait',
      errorCode: 'provider_temporary_failure',
      nextAttemptAt: '2026-08-27T14:00:04.000Z',
    });
  });

  it('dead-letters a retryable failure after provider attempt three', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore({ attempts: 2, beginAttempt: 3 });
    const temporary = Object.assign(new Error('temporary'), {
      code: 'provider_temporary_failure',
      retryable: true,
    });

    const result = await subject.processNextAIJob({
      workerId: 'worker-c',
      store,
      policy: policy(),
      execute: async () => Promise.reject(temporary),
    });

    expect(result).toMatchObject({ status: 'dead_letter', attempt: 3 });
    const failure = calls.find((call) => call.name === 'fail');
    expect(failure?.args[2]).toEqual({
      outcome: 'dead_letter',
      errorCode: 'provider_temporary_failure',
      nextAttemptAt: null,
    });
  });

  it.each(['invalid_json', 'schema_mismatch', 'provider_permanent_failure'])(
    'does not retry permanent failure %s',
    async (code) => {
      const subject = await loadSubject();
      if (!subject) return;
      const { store, calls } = createStore({ beginAttempt: 1 });
      const permanent = Object.assign(new Error(code), { code, retryable: false });

      const result = await subject.processNextAIJob({
        workerId: 'worker-d',
        store,
        policy: policy(),
        execute: async () => Promise.reject(permanent),
      });

      expect(result).toMatchObject({ status: 'failed', attempt: 1, errorCode: code });
      const failure = calls.find((call) => call.name === 'fail');
      expect(failure?.args[2]).toEqual({ outcome: 'failed', errorCode: code, nextAttemptAt: null });
      expect(calls.filter((call) => call.name === 'fail')).toHaveLength(1);
    },
  );

  it('turns the worker timeout into a retryable provider_timeout failure', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore({ beginAttempt: 1 });

    const result = await subject.processNextAIJob({
      workerId: 'worker-timeout',
      store,
      policy: policy({ timeoutMs: 5, retryBaseDelayMs: 1 }),
      execute: async () => new Promise(() => undefined),
    });

    expect(result).toMatchObject({ status: 'retry_wait', attempt: 1, errorCode: 'provider_timeout' });
    const failure = calls.find((call) => call.name === 'fail');
    expect(failure?.args[2]).toMatchObject({
      outcome: 'retry_wait',
      errorCode: 'provider_timeout',
    });
  });

  it('does not call the provider after losing the lease before attempt start', async () => {
    const subject = await loadSubject();
    if (!subject) return;
    const { store, calls } = createStore({ beginAttempt: null });
    let executed = false;

    const result = await subject.processNextAIJob({
      workerId: 'worker-stale',
      store,
      policy: policy(),
      execute: async () => {
        executed = true;
        return {};
      },
    });

    expect(result).toMatchObject({ status: 'stale_lease' });
    expect(executed).toBe(false);
    expect(calls.map((call) => call.name)).toEqual(['claim', 'beginAttempt']);
  });
});
