import { calculateNutritionTargets } from '../../../../packages/domain/src/nutrition/calculate-targets';

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'very_active';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type GoalType = 'fat_loss' | 'maintain' | 'muscle_gain';
export type OnboardingSex = 'male' | 'female';

export interface OnboardingInput {
  sex: OnboardingSex;
  birthDate: string;
  heightCm: number;
  currentWeightKg: number;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel;
  goalType: GoalType;
  targetWeightKg: number;
  trainingDaysPerWeek: number;
}

export interface OnboardingPreview {
  ageYears: number;
  bmrKcal: number;
  tdeeKcal: number;
  targetCaloriesKcal: number;
  targetProteinG: number;
}

export interface PersistedOnboardingPayload {
  userId: string;
  profile: {
    sex: OnboardingSex;
    birthDate: string;
    heightCm: number;
    currentWeightKg: number;
    activityLevel: ActivityLevel;
    experienceLevel: ExperienceLevel;
  };
  goal: {
    goalType: GoalType;
    targetWeightKg: number;
    targetCalories: number;
    targetProteinG: number;
    trainingDaysPerWeek: number;
  };
}

const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
};

const GOAL_RULES: Readonly<
  Record<GoalType, { calorieAdjustmentKcal: number; proteinGramsPerKg: number }>
> = {
  fat_loss: { calorieAdjustmentKcal: -300, proteinGramsPerKg: 1.8 },
  maintain: { calorieAdjustmentKcal: 0, proteinGramsPerKg: 1.6 },
  muscle_gain: { calorieAdjustmentKcal: 200, proteinGramsPerKg: 1.8 },
};

const SEX_VALUES = new Set<OnboardingSex>(['male', 'female']);
const ACTIVITY_VALUES = new Set<ActivityLevel>(['sedentary', 'light', 'moderate', 'very_active']);
const EXPERIENCE_VALUES = new Set<ExperienceLevel>(['beginner', 'intermediate', 'advanced']);
const GOAL_VALUES = new Set<GoalType>(['fat_loss', 'maintain', 'muscle_gain']);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateOnboardingInput(input: unknown): {
  valid: boolean;
  errors: Readonly<Record<string, string>>;
} {
  const errors: Record<string, string> = {};
  if (!isRecord(input)) {
    return { valid: false, errors: { form: 'ข้อมูล onboarding ไม่ถูกต้อง' } };
  }

  if (typeof input.sex !== 'string' || !SEX_VALUES.has(input.sex as OnboardingSex)) {
    errors.sex = 'กรุณาระบุเพศ';
  }
  if (!isIsoDate(input.birthDate)) {
    errors.birthDate = 'กรุณาระบุวันเกิดให้ถูกต้อง';
  }
  if (!isFinitePositive(input.heightCm) || input.heightCm > 300) {
    errors.heightCm = 'กรุณาระบุส่วนสูงเป็นเซนติเมตร';
  }
  if (!isFinitePositive(input.currentWeightKg) || input.currentWeightKg > 500) {
    errors.currentWeightKg = 'กรุณาระบุน้ำหนักปัจจุบันเป็นกิโลกรัม';
  }
  if (
    typeof input.activityLevel !== 'string' ||
    !ACTIVITY_VALUES.has(input.activityLevel as ActivityLevel)
  ) {
    errors.activityLevel = 'กรุณาระบุระดับกิจกรรม';
  }
  if (
    typeof input.experienceLevel !== 'string' ||
    !EXPERIENCE_VALUES.has(input.experienceLevel as ExperienceLevel)
  ) {
    errors.experienceLevel = 'กรุณาระบุประสบการณ์ฝึก';
  }
  if (typeof input.goalType !== 'string' || !GOAL_VALUES.has(input.goalType as GoalType)) {
    errors.goalType = 'กรุณาระบุเป้าหมาย';
  }
  if (!isFinitePositive(input.targetWeightKg) || input.targetWeightKg > 500) {
    errors.targetWeightKg = 'กรุณาระบุน้ำหนักเป้าหมายเป็นกิโลกรัม';
  }
  if (
    typeof input.trainingDaysPerWeek !== 'number' ||
    !Number.isInteger(input.trainingDaysPerWeek) ||
    input.trainingDaysPerWeek < 0 ||
    input.trainingDaysPerWeek > 7
  ) {
    errors.trainingDaysPerWeek = 'จำนวนวันฝึกต้องอยู่ระหว่าง 0 ถึง 7 วัน';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

function assertOnboardingInput(input: unknown): asserts input is OnboardingInput {
  const validation = validateOnboardingInput(input);
  if (!validation.valid) {
    throw new Error(`Invalid onboarding input: ${Object.keys(validation.errors).join(', ')}`);
  }
}

export function calculateAgeYears(birthDate: string, asOfDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  const asOf = new Date(`${asOfDate}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(asOf.getTime()) || birth > asOf) {
    throw new RangeError('birthDate must be on or before asOfDate');
  }

  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < birth.getUTCMonth() ||
    (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age <= 0) throw new RangeError('ageYears must be positive');
  return age;
}

export function calculateOnboardingPreview(
  input: OnboardingInput,
  options: { asOfDate?: string } = {},
): OnboardingPreview {
  assertOnboardingInput(input);
  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
  const ageYears = calculateAgeYears(input.birthDate, asOfDate);
  const goalRule = GOAL_RULES[input.goalType];
  const targets = calculateNutritionTargets({
    sex: input.sex,
    ageYears,
    height: { value: input.heightCm, unit: 'cm' },
    weight: { value: input.currentWeightKg, unit: 'kg' },
    activityMultiplier: ACTIVITY_MULTIPLIERS[input.activityLevel],
    calorieAdjustmentKcal: goalRule.calorieAdjustmentKcal,
    proteinGramsPerKg: goalRule.proteinGramsPerKg,
  });

  return {
    ageYears,
    bmrKcal: targets.display.bmrKcal,
    tdeeKcal: targets.display.tdeeKcal,
    targetCaloriesKcal: targets.display.targetCaloriesKcal,
    targetProteinG: targets.display.targetProteinG,
  };
}

export function createOnboardingService(dependencies: {
  saveConfirmedOnboarding: (input: PersistedOnboardingPayload) => Promise<void>;
}) {
  return {
    async save(input: {
      userId: string;
      onboarding: OnboardingInput;
      confirmed: boolean;
      asOfDate?: string;
    }): Promise<OnboardingPreview> {
      if (!input.confirmed) {
        throw new Error('Explicit confirmation required before onboarding can be saved');
      }
      if (!input.userId) {
        throw new Error('Authenticated user required');
      }

      assertOnboardingInput(input.onboarding);
      const preview = calculateOnboardingPreview(
        input.onboarding,
        input.asOfDate ? { asOfDate: input.asOfDate } : {},
      );

      await dependencies.saveConfirmedOnboarding({
        userId: input.userId,
        profile: {
          sex: input.onboarding.sex,
          birthDate: input.onboarding.birthDate,
          heightCm: input.onboarding.heightCm,
          currentWeightKg: input.onboarding.currentWeightKg,
          activityLevel: input.onboarding.activityLevel,
          experienceLevel: input.onboarding.experienceLevel,
        },
        goal: {
          goalType: input.onboarding.goalType,
          targetWeightKg: input.onboarding.targetWeightKg,
          targetCalories: preview.targetCaloriesKcal,
          targetProteinG: preview.targetProteinG,
          trainingDaysPerWeek: input.onboarding.trainingDaysPerWeek,
        },
      });

      return preview;
    },
  };
}
