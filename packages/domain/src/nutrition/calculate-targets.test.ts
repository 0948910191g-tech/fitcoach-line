import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './calculate-targets';
  return import(modulePath).catch(() => ({}));
}

describe('calculateNutritionTargets', () => {
  it('produces equivalent stored targets for metric and imperial inputs', async () => {
    const subject = await loadSubject();
    expect('calculateNutritionTargets' in subject).toBe(true);
    if (!('calculateNutritionTargets' in subject)) return;

    const calculateNutritionTargets = subject.calculateNutritionTargets;
    const metric = calculateNutritionTargets({
      sex: 'male',
      ageYears: 30,
      height: { value: 180, unit: 'cm' },
      weight: { value: 80, unit: 'kg' },
      activityMultiplier: 1.55,
      calorieAdjustmentKcal: -300,
      proteinGramsPerKg: 1.8,
    });
    const imperial = calculateNutritionTargets({
      sex: 'male',
      ageYears: 30,
      height: { value: 70.8661417323, unit: 'in' },
      weight: { value: 176.3698097479, unit: 'lb' },
      activityMultiplier: 1.55,
      calorieAdjustmentKcal: -300,
      proteinGramsPerKg: 1.8,
    });

    expect(imperial.storage.heightCm).toBeCloseTo(metric.storage.heightCm, 6);
    expect(imperial.storage.weightKg).toBeCloseTo(metric.storage.weightKg, 6);
    expect(imperial.storage.targetCaloriesKcal).toBeCloseTo(metric.storage.targetCaloriesKcal, 3);
    expect(imperial.storage.targetProteinG).toBeCloseTo(metric.storage.targetProteinG, 3);
  });

  it('uses zero calorie adjustment when optional adjustment is missing', async () => {
    const subject = await loadSubject();
    expect('calculateNutritionTargets' in subject).toBe(true);
    if (!('calculateNutritionTargets' in subject)) return;

    const result = subject.calculateNutritionTargets({
      sex: 'female',
      ageYears: 28,
      height: { value: 165, unit: 'cm' },
      weight: { value: 60, unit: 'kg' },
      activityMultiplier: 1.4,
      proteinGramsPerKg: 1.6,
    });

    expect(result.storage.targetCaloriesKcal).toBe(result.storage.tdeeKcal);
    expect(result.display.targetCaloriesKcal).toBe(Math.round(result.storage.targetCaloriesKcal));
    expect(result.display.targetProteinG).toBe(Math.round(result.storage.targetProteinG));
  });

  it('rejects a negative calculated calorie target', async () => {
    const subject = await loadSubject();
    expect('calculateNutritionTargets' in subject).toBe(true);
    if (!('calculateNutritionTargets' in subject)) return;

    expect(() =>
      subject.calculateNutritionTargets({
        sex: 'male',
        ageYears: 30,
        height: { value: 180, unit: 'cm' },
        weight: { value: 80, unit: 'kg' },
        activityMultiplier: 1.2,
        calorieAdjustmentKcal: -10_000,
        proteinGramsPerKg: 1.8,
      }),
    ).toThrow(/calorie/i);
  });
});
