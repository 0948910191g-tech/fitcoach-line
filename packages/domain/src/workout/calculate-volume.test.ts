import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './calculate-volume';
  return import(modulePath).catch(() => ({}));
}

describe('calculateSetVolume', () => {
  it('returns zero volume for a zero-weight set without rejecting it', async () => {
    const subject = await loadSubject();
    expect('calculateSetVolume' in subject).toBe(true);
    if (!('calculateSetVolume' in subject)) return;

    const result = subject.calculateSetVolume({
      repetitions: 12,
      externalLoad: { value: 0, unit: 'kg' },
      rpe: 7,
    });

    expect(result.storage.effectiveLoadKg).toBe(0);
    expect(result.storage.volumeKgReps).toBe(0);
  });

  it('includes explicit bodyweight contribution for bodyweight exercise', async () => {
    const subject = await loadSubject();
    expect('calculateSetVolume' in subject).toBe(true);
    if (!('calculateSetVolume' in subject)) return;

    const result = subject.calculateSetVolume({
      repetitions: 10,
      bodyWeight: { value: 80, unit: 'kg' },
      bodyWeightFraction: 1,
      rpe: 8,
    });

    expect(result.storage.effectiveLoadKg).toBe(80);
    expect(result.storage.volumeKgReps).toBe(800);
    expect(result.display.volumeKgReps).toBe(800);
  });

  it('converts pounds to kilograms before calculating stored volume', async () => {
    const subject = await loadSubject();
    expect('calculateSetVolume' in subject).toBe(true);
    if (!('calculateSetVolume' in subject)) return;

    const result = subject.calculateSetVolume({
      repetitions: 5,
      externalLoad: { value: 220.4622621849, unit: 'lb' },
    });

    expect(result.storage.effectiveLoadKg).toBeCloseTo(100, 6);
    expect(result.storage.volumeKgReps).toBeCloseTo(500, 5);
  });

  it.each([0, -1, 1.5])('rejects non-positive or non-integer repetitions (%s)', async (repetitions: number) => {
    const subject = await loadSubject();
    expect('calculateSetVolume' in subject).toBe(true);
    if (!('calculateSetVolume' in subject)) return;
    expect(() => subject.calculateSetVolume({ repetitions })).toThrow(/repetitions/i);
  });

  it.each([0, 11])('rejects RPE outside 1..10 (%s)', async (rpe: number) => {
    const subject = await loadSubject();
    expect('calculateSetVolume' in subject).toBe(true);
    if (!('calculateSetVolume' in subject)) return;
    expect(() => subject.calculateSetVolume({ repetitions: 5, rpe })).toThrow(/RPE/i);
  });
});
