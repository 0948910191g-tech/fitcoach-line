import type { ZodType } from 'zod';
import {
  coachReplySchema,
  dailyReportSchema,
  weeklyReportSchema,
  type CoachReply,
  type DailyReport,
  type WeeklyReport,
} from './schemas/coach.js';
import { foodAnalysisSchema, type FoodAnalysis } from './schemas/food.js';
import { workoutAnalysisSchema, type WorkoutAnalysis } from './schemas/workout.js';
import type {
  AIProvider,
  AIProviderExecutionContext,
  AnalyzeFoodInput,
  CoachInput,
  DailyReportInput,
  ParseWorkoutInput,
  WeeklyReportInput,
} from './provider.js';

export type AIOutputValidationCode = 'invalid_json' | 'schema_mismatch';

export class AIOutputValidationError extends Error {
  readonly code: AIOutputValidationCode;
  readonly retryable = false;

  constructor(message: string, code: AIOutputValidationCode, cause?: unknown) {
    super(message);
    this.name = 'AIOutputValidationError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function parseValidatedOutput<T>(raw: unknown, schema: ZodType<T>): T {
  let parsed = raw;

  // Static provider contracts return structured values, but a real provider
  // adapter can still violate that contract at runtime. Keep malformed text
  // distinguishable from a structurally invalid JSON value for worker policy.
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new AIOutputValidationError('AI provider returned invalid JSON', 'invalid_json', error);
    }
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AIOutputValidationError(
      'AI provider output did not match the required schema',
      'schema_mismatch',
      result.error,
    );
  }

  return result.data;
}

export interface AIRouter {
  analyzeFood(input: AnalyzeFoodInput, context?: AIProviderExecutionContext): Promise<FoodAnalysis>;
  parseWorkout(
    input: ParseWorkoutInput,
    context?: AIProviderExecutionContext,
  ): Promise<WorkoutAnalysis>;
  generateCoachReply(input: CoachInput, context?: AIProviderExecutionContext): Promise<CoachReply>;
  generateDailyReport(
    input: DailyReportInput,
    context?: AIProviderExecutionContext,
  ): Promise<DailyReport>;
  generateWeeklyReport(
    input: WeeklyReportInput,
    context?: AIProviderExecutionContext,
  ): Promise<WeeklyReport>;
}

export function createAIRouter(provider: AIProvider): AIRouter {
  return {
    async analyzeFood(input, context) {
      return parseValidatedOutput(await provider.analyzeFood(input, context), foodAnalysisSchema);
    },
    async parseWorkout(input, context) {
      return parseValidatedOutput(await provider.parseWorkout(input, context), workoutAnalysisSchema);
    },
    async generateCoachReply(input, context) {
      return parseValidatedOutput(await provider.generateCoachReply(input, context), coachReplySchema);
    },
    async generateDailyReport(input, context) {
      return parseValidatedOutput(await provider.generateDailyReport(input, context), dailyReportSchema);
    },
    async generateWeeklyReport(input, context) {
      return parseValidatedOutput(await provider.generateWeeklyReport(input, context), weeklyReportSchema);
    },
  };
}
