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
 * Provider output is deliberately untrusted JSON text.
 * Feature/business code must consume it through createAIRouter(), which
 * performs runtime Zod validation before returning structured data.
 */
export interface AIProvider {
  analyzeFood(input: AnalyzeFoodInput): Promise<string>;
  parseWorkout(input: ParseWorkoutInput): Promise<string>;
  generateCoachReply(input: CoachInput): Promise<string>;
  generateDailyReport(input: DailyReportInput): Promise<string>;
  generateWeeklyReport(input: WeeklyReportInput): Promise<string>;
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
