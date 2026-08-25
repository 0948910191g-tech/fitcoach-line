export interface NutrientInput {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sugarG?: number;
  sodiumMg?: number;
  confidence?: number;
}

export interface NutrientTotals {
  storage: {
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    sugarG: number | null;
    sodiumMg: number | null;
  };
  display: {
    caloriesKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    sugarG: number | null;
    sodiumMg: number | null;
  };
}

function roundStorage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function sumNutrients(items: readonly NutrientInput[]): NutrientTotals {
  let caloriesKcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let sugarG = 0;
  let sodiumMg = 0;
  let hasSugar = false;
  let hasSodium = false;

  for (const item of items) {
    assertNonNegative(item.caloriesKcal, 'caloriesKcal');
    assertNonNegative(item.proteinG, 'proteinG');
    assertNonNegative(item.carbsG, 'carbsG');
    assertNonNegative(item.fatG, 'fatG');

    if (item.sugarG !== undefined) {
      assertNonNegative(item.sugarG, 'sugarG');
      sugarG = roundStorage(sugarG + item.sugarG);
      hasSugar = true;
    }
    if (item.sodiumMg !== undefined) {
      assertNonNegative(item.sodiumMg, 'sodiumMg');
      sodiumMg = roundStorage(sodiumMg + item.sodiumMg);
      hasSodium = true;
    }
    if (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) {
      throw new RangeError('confidence must be between 0 and 1');
    }

    caloriesKcal = roundStorage(caloriesKcal + item.caloriesKcal);
    proteinG = roundStorage(proteinG + item.proteinG);
    carbsG = roundStorage(carbsG + item.carbsG);
    fatG = roundStorage(fatG + item.fatG);
  }

  const storage = {
    caloriesKcal,
    proteinG,
    carbsG,
    fatG,
    sugarG: hasSugar ? sugarG : null,
    sodiumMg: hasSodium ? sodiumMg : null,
  };

  return {
    storage,
    display: {
      caloriesKcal: Math.round(storage.caloriesKcal),
      proteinG: round1(storage.proteinG),
      carbsG: round1(storage.carbsG),
      fatG: round1(storage.fatG),
      sugarG: storage.sugarG === null ? null : round1(storage.sugarG),
      sodiumMg: storage.sodiumMg === null ? null : Math.round(storage.sodiumMg),
    },
  };
}
