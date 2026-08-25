import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './estimate-energy';
  return import(modulePath).catch(() => ({}));
}

describe('estimateExerciseEnergyRange', () => {
  it('produces equivalent energy for metric and imperial body weight', async () => {
    const subject = await loadSubject();
    expect('estimateExerciseEnergyRange' in subject).toBe(true);
    if (!('estimateExerciseEnergyRange' in subject)) return;

    const metric = subject.estimateExerciseEnergyRange({
      bodyWeight: { value: 80, unit: 'kg' },
      duration: { value: 30, unit: 'minutes' },
      metRange: { low: 5, high: 7 },
      rpe: 7,
      confidence: 0.8,
    });
    const imperial = subject.estimateExerciseEnergyRange({
      bodyWeight: { value: 176.3698097479, unit: 'lb' },
      duration: { value: 1800, unit: 'seconds' },
      metRange: { low: 5, high: 7 },
      rpe: 7,
      confidence: 0.8,
    });

    expect(imperial.storage.lowKcal).toBeCloseTo(metric.storage.lowKcal, 4);
    expect(imperial.storage.highKcal).toBeCloseTo(metric.storage.highKcal, 4);
    expect(metric.display.lowKcal).toBe(Math.round(metric.storage.lowKcal));
    expect(metric.display.highKcal).toBe(Math.round(metric.storage.highKcal));
  });

  it.each([0, -10])('rejects non-positive exercise duration (%s)', async (value: number) => {
    const subject = await loadSubject();
    expect('estimateExerciseEnergyRange' in subject).toBe(true);
    if (!('estimateExerciseEnergyRange' in subject)) return;
    expect(() =>
      subject.estimateExerciseEnergyRange({
        bodyWeight: { value: 70, unit: 'kg' },
        duration: { value, unit: 'minutes' },
        metRange: { low: 3, high: 5 },
      }),
    ).toThrow(/duration/i);
  });

  it.each([-0.01, 1.01])('rejects confidence outside 0..1 (%s)', async (confidence: number) => {
    const subject = await loadSubject();
    expect('estimateExerciseEnergyRange' in subject).toBe(true);
    if (!('estimateExerciseEnergyRange' in subject)) return;
    expect(() =>
      subject.estimateExerciseEnergyRange({
        bodyWeight: { value: 70, unit: 'kg' },
        duration: { value: 30, unit: 'minutes' },
        metRange: { low: 3, high: 5 },
        confidence,
      }),
    ).toThrow(/confidence/i);
  });
});
