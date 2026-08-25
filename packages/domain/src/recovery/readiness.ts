export type ReadinessFlag = 'low_sleep' | 'high_fatigue' | 'high_soreness' | 'low_readiness';
export type RecoveryField = 'sleepHours' | 'sleepQuality' | 'fatigue' | 'soreness' | 'readiness';

export interface RecoveryInput {
  sleepHours?: number;
  sleepQuality?: number;
  fatigue?: number;
  soreness?: number;
  readiness?: number;
}

export interface ReadinessFlagsResult {
  flags: ReadinessFlag[];
  missing: RecoveryField[];
}

const RATING_FIELDS = ['sleepQuality', 'fatigue', 'soreness', 'readiness'] as const;

export function calculateReadinessFlags(input: RecoveryInput): ReadinessFlagsResult {
  if (input.sleepHours !== undefined && (!Number.isFinite(input.sleepHours) || input.sleepHours <= 0)) {
    throw new RangeError('sleepHours must be a positive duration');
  }

  for (const field of RATING_FIELDS) {
    const value = input[field];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 10)) {
      throw new RangeError(`${field} must be an integer in the 1..10 range`);
    }
  }

  const flags: ReadinessFlag[] = [];
  if (input.sleepHours !== undefined && input.sleepHours < 6) flags.push('low_sleep');
  if (input.fatigue !== undefined && input.fatigue >= 8) flags.push('high_fatigue');
  if (input.soreness !== undefined && input.soreness >= 8) flags.push('high_soreness');
  if (input.readiness !== undefined && input.readiness <= 3) flags.push('low_readiness');

  const missing: RecoveryField[] = [];
  for (const field of ['sleepHours', ...RATING_FIELDS] as const) {
    if (input[field] === undefined) missing.push(field);
  }

  return { flags, missing };
}
