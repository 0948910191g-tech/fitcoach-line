export type Sex = 'male' | 'female';
export type Length = { value: number; unit: 'cm' | 'in' };
export type Mass = { value: number; unit: 'kg' | 'lb' };

export interface NutritionTargetInput {
  sex: Sex;
  ageYears: number;
  height: Length;
  weight: Mass;
  activityMultiplier: number;
  calorieAdjustmentKcal?: number;
  proteinGramsPerKg: number;
}

export interface NutritionTargets {
  storage: {
    heightCm: number;
    weightKg: number;
    bmrKcal: number;
    tdeeKcal: number;
    targetCaloriesKcal: number;
    targetProteinG: number;
  };
  display: {
    bmrKcal: number;
    tdeeKcal: number;
    targetCaloriesKcal: number;
    targetProteinG: number;
  };
}

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;

function roundStorage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export function calculateNutritionTargets(input: NutritionTargetInput): NutritionTargets {
  if (!Number.isInteger(input.ageYears) || input.ageYears <= 0) {
    throw new RangeError('ageYears must be a positive integer');
  }
  assertPositiveFinite(input.height.value, 'height');
  assertPositiveFinite(input.weight.value, 'weight');
  assertPositiveFinite(input.activityMultiplier, 'activityMultiplier');
  assertPositiveFinite(input.proteinGramsPerKg, 'proteinGramsPerKg');

  const adjustment = input.calorieAdjustmentKcal ?? 0;
  if (!Number.isFinite(adjustment)) {
    throw new RangeError('calorieAdjustmentKcal must be finite');
  }

  const heightCm = input.height.unit === 'cm' ? input.height.value : input.height.value * IN_TO_CM;
  const weightKg = input.weight.unit === 'kg' ? input.weight.value : input.weight.value * LB_TO_KG;
  const sexOffset = input.sex === 'male' ? 5 : -161;
  const bmrKcal = 10 * weightKg + 6.25 * heightCm - 5 * input.ageYears + sexOffset;
  const tdeeKcal = bmrKcal * input.activityMultiplier;
  const targetCaloriesKcal = tdeeKcal + adjustment;
  const targetProteinG = weightKg * input.proteinGramsPerKg;

  if (targetCaloriesKcal < 0) {
    throw new RangeError('calorie target cannot be negative');
  }
  if (targetProteinG < 0) {
    throw new RangeError('protein target cannot be negative');
  }

  const storage = {
    heightCm: roundStorage(heightCm),
    weightKg: roundStorage(weightKg),
    bmrKcal: roundStorage(bmrKcal),
    tdeeKcal: roundStorage(tdeeKcal),
    targetCaloriesKcal: roundStorage(targetCaloriesKcal),
    targetProteinG: roundStorage(targetProteinG),
  };

  return {
    storage,
    display: {
      bmrKcal: Math.round(storage.bmrKcal),
      tdeeKcal: Math.round(storage.tdeeKcal),
      targetCaloriesKcal: Math.round(storage.targetCaloriesKcal),
      targetProteinG: Math.round(storage.targetProteinG),
    },
  };
}
