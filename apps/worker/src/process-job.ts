export interface WorkerPolicy {
  dailyLimit: number;
  warningAt: number;
  concurrencyLimit: number;
  timeoutMs: number;
  maxProviderAttempts: number;
  retryBaseDelayMs: number;
  leaseSeconds: number;
}

export const OWNER_ALPHA_WORKER_POLICY: Readonly<WorkerPolicy> = Object.freeze({
  dailyLimit: 50,
  warningAt: 40,
  concurrencyLimit: 1,
  timeoutMs: 90_000,
  maxProviderAttempts: 3,
  retryBaseDelayMs: 1_000,
  leaseSeconds: 120,
});

export interface ClaimedAIJob {
  jobId: string;
  userId: string;
  taskType: string;
  provider: string;
  inputRef: string | null;
  attempts: number;
  leaseToken: string;
  leaseExpiresAt: string;
  quotaUsed: number;
}

export interface ClaimOptions {
  leaseSeconds: number;
  dailyLimit: number;
  concurrencyLimit: number;
}

export type AIJobFailureOutcome = 'retry_wait' | 'failed' | 'dead_letter';

export interface AIJobFailure {
  outcome: AIJobFailureOutcome;
  errorCode: string;
  nextAttemptAt: string | null;
}

export interface AIJobStore {
  claim(workerId: string, options: ClaimOptions): Promise<ClaimedAIJob | null>;
  beginAttempt(jobId: string, leaseToken: string): Promise<number | null>;
  complete(jobId: string, leaseToken: string, output: unknown): Promise<boolean>;
  fail(jobId: string, leaseToken: string, failure: AIJobFailure): Promise<boolean>;
}

export interface SupabaseAIJobStoreConfig {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

interface ClaimRow {
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

function createServiceHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export function createSupabaseAIJobStore(config: SupabaseAIJobStoreConfig): AIJobStore {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers = createServiceHeaders(config.serviceRoleKey);

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, config.url), {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    const text = await response.text();
    const body = (text ? JSON.parse(text) : null) as T;

    if (!response.ok) {
      throw new Error(`AI job RPC ${name} failed with HTTP ${response.status}`);
    }

    return body;
  }

  return {
    async claim(workerId, options) {
      const rows = await rpc<ClaimRow[]>('claim_ai_job_v1', {
        p_worker_id: workerId,
        p_lease_seconds: options.leaseSeconds,
        p_daily_limit: options.dailyLimit,
        p_concurrency_limit: options.concurrencyLimit,
      });
      const row = rows[0];
      if (!row) return null;

      return {
        jobId: row.job_id,
        userId: row.user_id,
        taskType: row.task_type,
        provider: row.provider,
        inputRef: row.input_ref,
        attempts: row.attempts,
        leaseToken: row.lease_token,
        leaseExpiresAt: row.lease_expires_at,
        quotaUsed: row.quota_used,
      };
    },

    async beginAttempt(jobId, leaseToken) {
      return rpc<number | null>('begin_ai_job_attempt_v1', {
        p_job_id: jobId,
        p_lease_token: leaseToken,
      });
    },

    async complete(jobId, leaseToken, output) {
      return rpc<boolean>('complete_ai_job_v1', {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_output_json: output,
      });
    },

    async fail(jobId, leaseToken, failure) {
      return rpc<boolean>('fail_ai_job_attempt_v1', {
        p_job_id: jobId,
        p_lease_token: leaseToken,
        p_outcome: failure.outcome,
        p_error_code: failure.errorCode,
        p_next_attempt_at: failure.nextAttemptAt,
      });
    },
  };
}

export interface ProcessNextAIJobOptions {
  workerId: string;
  store: AIJobStore;
  execute(job: ClaimedAIJob, signal: AbortSignal): Promise<unknown>;
  policy?: WorkerPolicy;
  now?: () => Date;
  onQuotaWarning?: (warning: { used: number; limit: number }) => void;
}

export type ProcessAIJobResult =
  | { status: 'no_job' }
  | { status: 'stale_lease'; jobId: string; attempt?: number }
  | { status: 'completed'; jobId: string; attempt: number; quotaUsed: number }
  | {
      status: 'retry_wait' | 'failed' | 'dead_letter';
      jobId: string;
      attempt: number;
      errorCode: string;
      quotaUsed: number;
    };

class ProviderTimeoutError extends Error {
  readonly code = 'provider_timeout';
  readonly retryable = true;

  constructor() {
    super('AI provider timed out');
    this.name = 'ProviderTimeoutError';
  }
}

interface ClassifiedFailure {
  code: string;
  retryable: boolean;
}

function classifyFailure(error: unknown): ClassifiedFailure {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'retryable' in error &&
    typeof error.retryable === 'boolean'
  ) {
    return { code: error.code, retryable: error.retryable };
  }

  return { code: 'worker_unclassified_error', retryable: false };
}

async function executeWithTimeout(
  execute: ProcessNextAIJobOptions['execute'],
  job: ClaimedAIJob,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderTimeoutError());
      }, timeoutMs);
    });

    return await Promise.race([execute(job, controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function retryAt(now: Date, attempt: number, baseDelayMs: number): string {
  const delayMs = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return new Date(now.getTime() + delayMs).toISOString();
}

export async function processNextAIJob(
  options: ProcessNextAIJobOptions,
): Promise<ProcessAIJobResult> {
  const policy = options.policy ?? OWNER_ALPHA_WORKER_POLICY;
  const now = options.now ?? (() => new Date());
  const job = await options.store.claim(options.workerId, {
    leaseSeconds: policy.leaseSeconds,
    dailyLimit: policy.dailyLimit,
    concurrencyLimit: policy.concurrencyLimit,
  });

  if (!job) return { status: 'no_job' };

  if (job.attempts === 0 && job.quotaUsed === policy.warningAt) {
    options.onQuotaWarning?.({ used: job.quotaUsed, limit: policy.dailyLimit });
  }

  if (job.attempts >= policy.maxProviderAttempts) {
    const failure: AIJobFailure = {
      outcome: 'dead_letter',
      errorCode: 'provider_attempt_limit_exceeded',
      nextAttemptAt: null,
    };
    const persisted = await options.store.fail(job.jobId, job.leaseToken, failure);
    if (!persisted) return { status: 'stale_lease', jobId: job.jobId };
    return {
      status: 'dead_letter',
      jobId: job.jobId,
      attempt: job.attempts,
      errorCode: failure.errorCode,
      quotaUsed: job.quotaUsed,
    };
  }

  const attempt = await options.store.beginAttempt(job.jobId, job.leaseToken);
  if (attempt === null) return { status: 'stale_lease', jobId: job.jobId };

  try {
    const output = await executeWithTimeout(options.execute, job, policy.timeoutMs);
    const completed = await options.store.complete(job.jobId, job.leaseToken, output);
    if (!completed) return { status: 'stale_lease', jobId: job.jobId, attempt };

    return {
      status: 'completed',
      jobId: job.jobId,
      attempt,
      quotaUsed: job.quotaUsed,
    };
  } catch (error) {
    const classified = classifyFailure(error);
    const canRetry = classified.retryable && attempt < policy.maxProviderAttempts;
    const outcome: AIJobFailureOutcome = canRetry
      ? 'retry_wait'
      : classified.retryable
        ? 'dead_letter'
        : 'failed';
    const failure: AIJobFailure = {
      outcome,
      errorCode: classified.code,
      nextAttemptAt: canRetry ? retryAt(now(), attempt, policy.retryBaseDelayMs) : null,
    };

    const persisted = await options.store.fail(job.jobId, job.leaseToken, failure);
    if (!persisted) return { status: 'stale_lease', jobId: job.jobId, attempt };

    return {
      status: outcome,
      jobId: job.jobId,
      attempt,
      errorCode: classified.code,
      quotaUsed: job.quotaUsed,
    };
  }
}
