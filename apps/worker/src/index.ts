import {
  processNextAIJob,
  type AIJobStore,
  type ClaimedAIJob,
  type ProcessAIJobResult,
  type ProcessNextAIJobOptions,
  type WorkerPolicy,
} from './process-job';

const AI_ROUTER_MODULE_URL = new URL(
  '../../../packages/ai/src/router.ts',
  import.meta.url,
).href;

export interface WorkerAIProvider {
  analyzeFood(input: unknown): Promise<unknown>;
  parseWorkout(input: unknown): Promise<unknown>;
  generateCoachReply(input: unknown): Promise<unknown>;
  generateDailyReport(input: unknown): Promise<unknown>;
  generateWeeklyReport(input: unknown): Promise<unknown>;
}

export type AIJobExecution =
  | { method: 'analyzeFood'; input: unknown }
  | { method: 'parseWorkout'; input: unknown }
  | { method: 'generateCoachReply'; input: unknown }
  | { method: 'generateDailyReport'; input: unknown }
  | { method: 'generateWeeklyReport'; input: unknown };

interface ValidatedAIRouter {
  analyzeFood(input: unknown): Promise<unknown>;
  parseWorkout(input: unknown): Promise<unknown>;
  generateCoachReply(input: unknown): Promise<unknown>;
  generateDailyReport(input: unknown): Promise<unknown>;
  generateWeeklyReport(input: unknown): Promise<unknown>;
}

interface AIRouterModule {
  createAIRouter(provider: WorkerAIProvider): ValidatedAIRouter;
}

export interface CreateAIWorkerOptions {
  workerId: string;
  store: AIJobStore;
  provider: WorkerAIProvider;
  resolveExecution(
    job: ClaimedAIJob,
    signal: AbortSignal,
  ): AIJobExecution | Promise<AIJobExecution>;
  policy?: WorkerPolicy;
  now?: () => Date;
  onQuotaWarning?: (warning: { used: number; limit: number }) => void;
}

export interface AIWorker {
  runOnce(): Promise<ProcessAIJobResult>;
}

async function loadValidatedRouter(provider: WorkerAIProvider): Promise<ValidatedAIRouter> {
  const module = (await import(
    /* @vite-ignore */ AI_ROUTER_MODULE_URL
  )) as Partial<AIRouterModule>;
  if (typeof module.createAIRouter !== 'function') {
    throw new Error('AI router module does not expose createAIRouter');
  }
  return module.createAIRouter(provider);
}

async function executeValidated(
  router: ValidatedAIRouter,
  execution: AIJobExecution,
): Promise<unknown> {
  switch (execution.method) {
    case 'analyzeFood':
      return router.analyzeFood(execution.input);
    case 'parseWorkout':
      return router.parseWorkout(execution.input);
    case 'generateCoachReply':
      return router.generateCoachReply(execution.input);
    case 'generateDailyReport':
      return router.generateDailyReport(execution.input);
    case 'generateWeeklyReport':
      return router.generateWeeklyReport(execution.input);
  }
}

export function createAIWorker(options: CreateAIWorkerOptions): AIWorker {
  let routerPromise: Promise<ValidatedAIRouter> | undefined;
  const getRouter = () => {
    routerPromise ??= loadValidatedRouter(options.provider);
    return routerPromise;
  };

  return {
    async runOnce() {
      const processOptions: ProcessNextAIJobOptions = {
        workerId: options.workerId,
        store: options.store,
        execute: async (job, signal) => {
          const execution = await options.resolveExecution(job, signal);
          const router = await getRouter();
          return executeValidated(router, execution);
        },
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.onQuotaWarning === undefined
          ? {}
          : { onQuotaWarning: options.onQuotaWarning }),
      };

      return processNextAIJob(processOptions);
    },
  };
}

export {
  OWNER_ALPHA_WORKER_POLICY,
  createSupabaseAIJobStore,
  processNextAIJob,
} from './process-job';
export type {
  AIJobFailure,
  AIJobFailureOutcome,
  AIJobStore,
  ClaimedAIJob,
  ProcessAIJobResult,
  ProcessNextAIJobOptions,
  WorkerPolicy,
} from './process-job';
