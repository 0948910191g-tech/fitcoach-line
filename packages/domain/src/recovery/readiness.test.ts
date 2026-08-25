import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './readiness';
  return import(modulePath).catch(() => ({}));
}

describe('calculateReadinessFlags', () => {
  it('marks missing optional recovery fields as missing rather than zero', async () => {
    const subject = await loadSubject();
    expect('calculateReadinessFlags' in subject).toBe(true);
    if (!('calculateReadinessFlags' in subject)) return;

    const result = subject.calculateReadinessFlags({ sleepHours: 7.5, fatigue: 3 });

    expect(result.missing).toEqual(['sleepQuality', 'soreness', 'readiness']);
    expect(result.flags).toEqual([]);
  });

  it('returns deterministic non-diagnostic readiness flags at configured boundaries', async () => {
    const subject = await loadSubject();
    expect('calculateReadinessFlags' in subject).toBe(true);
    if (!('calculateReadinessFlags' in subject)) return;

    const result = subject.calculateReadinessFlags({
      sleepHours: 5.9,
      sleepQuality: 4,
      fatigue: 8,
      soreness: 8,
      readiness: 3,
    });

    expect(result.flags).toEqual(['low_sleep', 'high_fatigue', 'high_soreness', 'low_readiness']);
    expect(result.missing).toEqual([]);
  });

  it.each([
    ['sleepQuality', 0],
    ['fatigue', 11],
    ['soreness', 0],
    ['readiness', 11],
  ])('rejects %s outside the 1..10 scale', async (field: string, value: number) => {
    const subject = await loadSubject();
    expect('calculateReadinessFlags' in subject).toBe(true);
    if (!('calculateReadinessFlags' in subject)) return;
    expect(() => subject.calculateReadinessFlags({ [field]: value })).toThrow(/1\.\.10/i);
  });
});
