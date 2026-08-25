import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './moving-average';
  return import(modulePath).catch(() => ({}));
}

describe('movingAverage7d', () => {
  it('does not impute missing days as zero and excludes data seven calendar days old', async () => {
    const subject = await loadSubject();
    expect('movingAverage7d' in subject).toBe(true);
    if (!('movingAverage7d' in subject)) return;

    const result = subject.movingAverage7d([
      { at: '2026-08-01T03:00:00Z', value: 70 },
      { at: '2026-08-08T03:00:00Z', value: 72 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      date: '2026-08-08',
      storageValue: 72,
      sampleDays: 1,
    });
  });

  it('uses Asia/Bangkok calendar boundaries', async () => {
    const subject = await loadSubject();
    expect('movingAverage7d' in subject).toBe(true);
    if (!('movingAverage7d' in subject)) return;

    const result = subject.movingAverage7d([
      { at: '2026-08-24T16:59:59Z', value: 70 },
      { at: '2026-08-24T17:00:00Z', value: 72 },
    ]);

    expect(result.map((point: { date: string }) => point.date)).toEqual(['2026-08-24', '2026-08-25']);
    expect(result[1]?.storageValue).toBe(71);
    expect(result[1]?.displayValue).toBe(71);
    expect(result[1]?.sampleDays).toBe(2);
  });

  it('averages multiple measurements within one Bangkok day before the seven-day average', async () => {
    const subject = await loadSubject();
    expect('movingAverage7d' in subject).toBe(true);
    if (!('movingAverage7d' in subject)) return;

    const result = subject.movingAverage7d([
      { at: '2026-08-25T01:00:00+07:00', value: 70 },
      { at: '2026-08-25T20:00:00+07:00', value: 72 },
    ]);

    expect(result).toEqual([
      { date: '2026-08-25', storageValue: 71, displayValue: 71, sampleDays: 1 },
    ]);
  });
});
