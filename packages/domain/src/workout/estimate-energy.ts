export type Mass = { value: number; unit: 'kg' | 'lb' };
export type Duration = { value: number; unit: 'minutes' | 'seconds' };

export interface ExerciseEnergyInput {
  bodyWeight: Mass;
  duration: Duration;
  metRange: { low: number; high: number };
  rpe?: number;
  confidence?: number;
}

export interface ExerciseEnergyRange {
  storage: {
    lowKcal: number;
    highKcal: number;
    durationMinutes: number;
    bodyWeightKg: number;
  };
  display: {
    lowKcal: number;
    highKcal: number;
  };
}

const LB_TO_KG = 0.45359237;

function roundStorage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateExerciseEnergyRange(input: ExerciseEnergyInput): ExerciseEnergyRange {
  const bodyWeightKg = input.bodyWeight.unit === 'kg' ? input.bodyWeight.value : input.bodyWeight.value * LB_TO_KG;
  if (!Number.isFinite(bodyWeightKg) || bodyWeightKg <= 0) {
    throw new RangeError('body weight must be a positive finite number');
  }

  if (!Number.isFinite(input.duration.value) || input.duration.value <= 0) {
    throw new RangeError('duration must be a positive finite number');
  }
  const durationMinutes = input.duration.unit === 'minutes' ? input.duration.value : input.duration.value / 60;

  if (!Number.isFinite(input.metRange.low) || !Number.isFinite(input.metRange.high) || input.metRange.low <= 0 || input.metRange.high <= 0 || input.metRange.high < input.metRange.low) {
    throw new RangeError('MET range must be positive and ordered low to high');
  }
  if (input.rpe !== undefined && (!Number.isFinite(input.rpe) || input.rpe < 1 || input.rpe > 10)) {
    throw new RangeError('RPE must be between 1 and 10');
  }
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new RangeError('confidence must be between 0 and 1');
  }

  const kcalForMet = (met: number) => (met * 3.5 * bodyWeightKg * durationMinutes) / 200;
  const storage = {
    lowKcal: roundStorage(kcalForMet(input.metRange.low)),
    highKcal: roundStorage(kcalForMet(input.metRange.high)),
    durationMinutes: roundStorage(durationMinutes),
    bodyWeightKg: roundStorage(bodyWeightKg),
  };

  return {
    storage,
    display: {
      lowKcal: Math.round(storage.lowKcal),
      highKcal: Math.round(storage.highKcal),
    },
  };
}
