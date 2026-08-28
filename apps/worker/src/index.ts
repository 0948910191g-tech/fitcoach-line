import {
  createAIRouter,
  type AIProvider,
  type AIRouter,
  type AnalyzeFoodInput,
  type CoachInput,
  type DailyReportInput,
  type ParseWorkoutInput,
  type WeeklyReportInput,
} from '@fitcoach/ai';
import {
  processNextAIJob,
  type AIJobStore,
  type ClaimedAIJob,
  type ProcessAIJobResult,
  type ProcessNextAIJobOptions,
  type WorkerPolicy,
} from './process-job.js';

export type WorkerAIProvider = AIProvider;

export type AIJobExecution =
  | { method: 'analyzeFood'; input: AnalyzeFoodInput }
  | { method: 'parseWorkout'; input: ParseWorkoutInput }
  | { method: 'generateCoachReply'; input: CoachInput }
  | { method: 'generateDailyReport'; input: DailyReportInput }
  | { method: 'generateWeeklyReport'; input: WeeklyReportInput };

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

async function executeValidated(
  router: AIRouter,
  execution: AIJobExecution,
  signal: AbortSignal,
): Promise<unknown> {
  const context = { signal };
  switch (execution.method) {
    case 'analyzeFood':
      return router.analyzeFood(execution.input, context);
    case 'parseWorkout':
      return router.parseWorkout(execution.input, context);
    case 'generateCoachReply':
      return router.generateCoachReply(execution.input, context);
    case 'generateDailyReport':
      return router.generateDailyReport(execution.input, context);
    case 'generateWeeklyReport':
      return router.generateWeeklyReport(execution.input, context);
  }
}

export function createAIWorker(options: CreateAIWorkerOptions): AIWorker {
  const router = createAIRouter(options.provider);

  return {
    async runOnce() {
      const processOptions: ProcessNextAIJobOptions = {
        workerId: options.workerId,
        store: options.store,
        execute: async (job, signal) => {
          const execution = await options.resolveExecution(job, signal);
          return executeValidated(router, execution, signal);
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
} from './process-job.js';
export type {
  AIJobFailure,
  AIJobFailureOutcome,
  AIJobStore,
  ClaimedAIJob,
  ProcessAIJobResult,
  ProcessNextAIJobOptions,
  WorkerPolicy,
} from './process-job.js';
