import type { CoachReply, DailyReport, WeeklyReport } from './schemas/coach';
import type { FoodAnalysis } from './schemas/food';
import type { WorkoutAnalysis } from './schemas/workout';

export interface ProviderImageInput {
  storagePath: string;
  mediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface AnalyzeFoodInput {
  text?: string;
  image?: ProviderImageInput;
  locale?: 'th-TH';
}

export interface ParseWorkoutInput {
  text: string;
  locale?: 'th-TH';
}

export interface CoachInput {
  question: string;
  facts: Readonly<Record<string, unknown>>;
  locale?: 'th-TH';
}

export interface DailyReportInput {
  facts: Readonly<Record<string, unknown>>;
  periodStart: string;
  periodEnd: string;
  locale?: 'th-TH';
}

export interface WeeklyReportInput {
  facts: Readonly<Record<string, unknown>>;
  periodStart: string;
  periodEnd: string;
  locale?: 'th-TH';
}

/**
 * Providers expose structured results at the TypeScript boundary. Their runtime
 * output is still untrusted and must pass createAIRouter() Zod validation before
 * feature/business code consumes it.
 */
export interface AIProvider {
  analyzeFood(input: AnalyzeFoodInput): Promise<FoodAnalysis>;
  parseWorkout(input: ParseWorkoutInput): Promise<WorkoutAnalysis>;
  generateCoachReply(input: CoachInput): Promise<CoachReply>;
  generateDailyReport(input: DailyReportInput): Promise<DailyReport>;
  generateWeeklyReport(input: WeeklyReportInput): Promise<WeeklyReport>;
}

export interface AIProviderErrorOptions {
  code: string;
  retryable: boolean;
  cause?: unknown;
}

export class AIProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: AIProviderErrorOptions) {
    super(message);
    this.name = 'AIProviderError';
    this.code = options.code;
    this.retryable = options.retryable;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
