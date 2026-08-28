import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AIProvider } from './provider';
import {
  coachReplySchema,
  dailyReportSchema,
  weeklyReportSchema,
  type CoachReply,
  type DailyReport,
  type WeeklyReport,
} from './schemas/coach';
import { foodAnalysisSchema, type FoodAnalysis } from './schemas/food';
import { workoutAnalysisSchema, type WorkoutAnalysis } from './schemas/workout';

const VALID_FOOD = foodAnalysisSchema.parse({
  confidence: 0.92,
  assumptions: ['synthetic fixture assumes one standard serving'],
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
      quantity: { value: 250, unit: 'g' },
      caloriesKcal: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 15,
      sugarG: 5,
      sodiumMg: 800,
    },
  ],
  totals: {
    caloriesKcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    sugarG: 5,
    sodiumMg: 800,
  },
});

const VALID_COACH = coachReplySchema.parse({
  confidence: 0.9,
  assumptions: ['synthetic fixture'],
  normalizedUnits: { energy: 'kcal', protein: 'g', weight: 'kg' },
  message: 'Synthetic coaching reply',
  factsUsed: ['synthetic-fact'],
  missingData: [],
});

const VALID_WORKOUT = workoutAnalysisSchema.parse({
  confidence: 0.9,
  assumptions: ['synthetic fixture'],
  normalizedUnits: { weight: 'kg', duration: 's', distance: 'm', energy: 'kcal' },
  mode: 'strength',
  exercises: [
    {
      name: 'Bench Press',
      sets: [{ reps: 10, weightKg: 40, rpe: 8 }],
    },
  ],
  estimatedEnergyKcal: { min: 100, max: 150 },
});

const VALID_DAILY_REPORT = dailyReportSchema.parse({
  confidence: 0.88,
  assumptions: ['synthetic fixture'],
  normalizedUnits: { energy: 'kcal', protein: 'g', weight: 'kg' },
  summary: 'Synthetic daily report',
  factsUsed: ['synthetic-fact'],
  missingData: [],
  nextActions: ['Synthetic next action'],
});

const VALID_WEEKLY_REPORT = weeklyReportSchema.parse({
  confidence: 0.86,
  assumptions: ['synthetic fixture'],
  normalizedUnits: { energy: 'kcal', protein: 'g', weight: 'kg' },
  summary: 'Synthetic weekly report',
  factsUsed: ['synthetic-fact'],
  missingData: [],
  nextActions: ['Synthetic next action'],
});

function fakeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    analyzeFood: overrides.analyzeFood ?? (async () => VALID_FOOD),
    parseWorkout: overrides.parseWorkout ?? (async () => VALID_WORKOUT),
    generateCoachReply: overrides.generateCoachReply ?? (async () => VALID_COACH),
    generateDailyReport: overrides.generateDailyReport ?? (async () => VALID_DAILY_REPORT),
    generateWeeklyReport: overrides.generateWeeklyReport ?? (async () => VALID_WEEKLY_REPORT),
  };
}

async function loadSubject() {
  const providerPath: string = './provider';
  const routerPath: string = './router';
  const providerModule = await import(providerPath).catch(() => ({}));
  const routerModule = await import(routerPath).catch(() => ({}));

  expect(providerModule.AIProviderError).toBeTypeOf('function');
  expect(routerModule.AIOutputValidationError).toBeTypeOf('function');
  expect(routerModule.createAIRouter).toBeTypeOf('function');

  if (
    typeof providerModule.AIProviderError !== 'function' ||
    typeof routerModule.AIOutputValidationError !== 'function' ||
    typeof routerModule.createAIRouter !== 'function'
  ) {
    return null;
  }

  return {
    AIProviderError: providerModule.AIProviderError,
    AIOutputValidationError: routerModule.AIOutputValidationError,
    createAIRouter: routerModule.createAIRouter,
  };
}

describe('AIProvider contract', () => {
  it('matches the exact structured return types from the handoff', () => {
    expectTypeOf<ReturnType<AIProvider['analyzeFood']>>().toEqualTypeOf<Promise<FoodAnalysis>>();
    expectTypeOf<ReturnType<AIProvider['parseWorkout']>>().toEqualTypeOf<Promise<WorkoutAnalysis>>();
    expectTypeOf<ReturnType<AIProvider['generateCoachReply']>>().toEqualTypeOf<Promise<CoachReply>>();
    expectTypeOf<ReturnType<AIProvider['generateDailyReport']>>().toEqualTypeOf<Promise<DailyReport>>();
    expectTypeOf<ReturnType<AIProvider['generateWeeklyReport']>>().toEqualTypeOf<Promise<WeeklyReport>>();
  });

  it('accepts a valid structured provider result through runtime validation', async () => {
    const subject = await loadSubject();
    if (!subject) return;

    const router = subject.createAIRouter(fakeProvider());
    const result = await router.analyzeFood({ text: 'synthetic meal' });

    expect(result.confidence).toBe(0.92);
    expect(result.normalizedUnits.energy).toBe('kcal');
    expect(result.items[0]?.quantity).toEqual({ value: 250, unit: 'g' });
    expect(result.totals.caloriesKcal).toBe(500);
  });

  it('rejects invalid JSON as a permanent validation failure', async () => {
    const subject = await loadSubject();
    if (!subject) return;

    const router = subject.createAIRouter(
      fakeProvider({
        analyzeFood: async () => '{ definitely-not-json' as unknown as FoodAnalysis,
      }),
    );

    await expect(router.analyzeFood({ text: 'synthetic meal' })).rejects.toMatchObject({
      name: 'AIOutputValidationError',
      code: 'invalid_json',
      retryable: false,
    });
  });

  it('rejects schema mismatch as a permanent validation failure', async () => {
    const subject = await loadSubject();
    if (!subject) return;

    const router = subject.createAIRouter(
      fakeProvider({
        analyzeFood: async () =>
          ({
            confidence: 4,
            assumptions: [],
            normalizedUnits: { energy: 'calories-ish' },
            items: [],
            totals: { caloriesKcal: -1 },
          }) as unknown as FoodAnalysis,
      }),
    );

    await expect(router.analyzeFood({ text: 'synthetic meal' })).rejects.toMatchObject({
      name: 'AIOutputValidationError',
      code: 'schema_mismatch',
      retryable: false,
    });
  });

  it('preserves timeout as a retryable provider failure', async () => {
    const subject = await loadSubject();
    if (!subject) return;

    const timeout = new subject.AIProviderError('Provider timed out', {
      code: 'provider_timeout',
      retryable: true,
    });
    const router = subject.createAIRouter(
      fakeProvider({ analyzeFood: async () => Promise.reject(timeout) }),
    );

    await expect(router.analyzeFood({ text: 'synthetic meal' })).rejects.toMatchObject({
      name: 'AIProviderError',
      code: 'provider_timeout',
      retryable: true,
    });
  });

  it('preserves temporary provider failure as retryable', async () => {
    const subject = await loadSubject();
    if (!subject) return;

    const temporary = new subject.AIProviderError('Temporary provider failure', {
      code: 'provider_temporary_failure',
      retryable: true,
    });
    const router = subject.createAIRouter(
      fakeProvider({ analyzeFood: async () => Promise.reject(temporary) }),
    );

    await expect(router.analyzeFood({ text: 'synthetic meal' })).rejects.toMatchObject({
      name: 'AIProviderError',
      code: 'provider_temporary_failure',
      retryable: true,
    });
  });

  it('preserves permanent provider failure as non-retryable', async () => {
    const subject = await loadSubject();
    if (!subject) return;

    const permanent = new subject.AIProviderError('Permanent provider failure', {
      code: 'provider_permanent_failure',
      retryable: false,
    });
    const router = subject.createAIRouter(
      fakeProvider({ analyzeFood: async () => Promise.reject(permanent) }),
    );

    await expect(router.analyzeFood({ text: 'synthetic meal' })).rejects.toMatchObject({
      name: 'AIProviderError',
      code: 'provider_permanent_failure',
      retryable: false,
    });
  });
});
