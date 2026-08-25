export type Mass = { value: number; unit: 'kg' | 'lb' };

export interface SetVolumeInput {
  repetitions: number;
  externalLoad?: Mass;
  bodyWeight?: Mass;
  bodyWeightFraction?: number;
  rpe?: number;
}

export interface SetVolumeResult {
  storage: {
    externalLoadKg: number;
    bodyWeightContributionKg: number;
    effectiveLoadKg: number;
    volumeKgReps: number;
  };
  display: {
    effectiveLoadKg: number;
    volumeKgReps: number;
  };
}

const LB_TO_KG = 0.45359237;

function roundStorage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toKg(mass: Mass): number {
  return mass.unit === 'kg' ? mass.value : mass.value * LB_TO_KG;
}

export function calculateSetVolume(input: SetVolumeInput): SetVolumeResult {
  if (!Number.isInteger(input.repetitions) || input.repetitions <= 0) {
    throw new RangeError('repetitions must be a positive integer');
  }
  if (input.rpe !== undefined && (!Number.isFinite(input.rpe) || input.rpe < 1 || input.rpe > 10)) {
    throw new RangeError('RPE must be between 1 and 10');
  }

  const externalLoadKg = input.externalLoad === undefined ? 0 : toKg(input.externalLoad);
  if (!Number.isFinite(externalLoadKg) || externalLoadKg < 0) {
    throw new RangeError('external load must be finite and non-negative');
  }

  if ((input.bodyWeight === undefined) !== (input.bodyWeightFraction === undefined)) {
    throw new RangeError('bodyWeight and bodyWeightFraction must be provided together');
  }

  let bodyWeightContributionKg = 0;
  if (input.bodyWeight !== undefined && input.bodyWeightFraction !== undefined) {
    const bodyWeightKg = toKg(input.bodyWeight);
    if (!Number.isFinite(bodyWeightKg) || bodyWeightKg <= 0) {
      throw new RangeError('body weight must be a positive finite number');
    }
    if (!Number.isFinite(input.bodyWeightFraction) || input.bodyWeightFraction < 0 || input.bodyWeightFraction > 1) {
      throw new RangeError('bodyWeightFraction must be between 0 and 1');
    }
    bodyWeightContributionKg = bodyWeightKg * input.bodyWeightFraction;
  }

  const effectiveLoadKg = externalLoadKg + bodyWeightContributionKg;
  const volumeKgReps = effectiveLoadKg * input.repetitions;
  const storage = {
    externalLoadKg: roundStorage(externalLoadKg),
    bodyWeightContributionKg: roundStorage(bodyWeightContributionKg),
    effectiveLoadKg: roundStorage(effectiveLoadKg),
    volumeKgReps: roundStorage(volumeKgReps),
  };

  return {
    storage,
    display: {
      effectiveLoadKg: Math.round(storage.effectiveLoadKg * 10) / 10,
      volumeKgReps: Math.round(storage.volumeKgReps * 10) / 10,
    },
  };
}
