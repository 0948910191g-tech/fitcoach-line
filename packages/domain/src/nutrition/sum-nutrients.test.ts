import { describe, expect, it } from 'vitest';

async function loadSubject() {
  const modulePath: string = './sum-nutrients';
  return import(modulePath).catch(() => ({}));
}

describe('sumNutrients', () => {
  it('preserves missing optional nutrients instead of treating them as zero', async () => {
    const subject = await loadSubject();
    expect('sumNutrients' in subject).toBe(true);
    if (!('sumNutrients' in subject)) return;

    const result = subject.sumNutrients([
      { caloriesKcal: 250.25, proteinG: 20.12, carbsG: 30.25, fatG: 5.5 },
      { caloriesKcal: 100.1, proteinG: 5.05, carbsG: 10.1, fatG: 2.25 },
    ]);

    expect(result.storage).toEqual({
      caloriesKcal: 350.35,
      proteinG: 25.17,
      carbsG: 40.35,
      fatG: 7.75,
      sugarG: null,
      sodiumMg: null,
    });
    expect(result.display).toEqual({
      caloriesKcal: 350,
      proteinG: 25.2,
      carbsG: 40.4,
      fatG: 7.8,
      sugarG: null,
      sodiumMg: null,
    });
  });

  it('sums optional nutrients when they are present in at least one item', async () => {
    const subject = await loadSubject();
    expect('sumNutrients' in subject).toBe(true);
    if (!('sumNutrients' in subject)) return;

    const result = subject.sumNutrients([
      { caloriesKcal: 10, proteinG: 1, carbsG: 2, fatG: 0, sugarG: 1.25, sodiumMg: 10.4 },
      { caloriesKcal: 20, proteinG: 2, carbsG: 3, fatG: 1, sodiumMg: 5.5 },
    ]);

    expect(result.storage.sugarG).toBe(1.25);
    expect(result.storage.sodiumMg).toBe(15.9);
  });

  it.each([
    ['calories', { caloriesKcal: -1, proteinG: 1, carbsG: 1, fatG: 1 }],
    ['protein', { caloriesKcal: 1, proteinG: -1, carbsG: 1, fatG: 1 }],
    ['carbs', { caloriesKcal: 1, proteinG: 1, carbsG: -1, fatG: 1 }],
    ['fat', { caloriesKcal: 1, proteinG: 1, carbsG: 1, fatG: -1 }],
  ])('rejects negative %s', async (_label: string, item: { caloriesKcal: number; proteinG: number; carbsG: number; fatG: number }) => {
    const subject = await loadSubject();
    expect('sumNutrients' in subject).toBe(true);
    if (!('sumNutrients' in subject)) return;
    expect(() => subject.sumNutrients([item])).toThrow(/non-negative/i);
  });

  it.each([-0.01, 1.01])('rejects confidence outside 0..1 (%s)', async (confidence: number) => {
    const subject = await loadSubject();
    expect('sumNutrients' in subject).toBe(true);
    if (!('sumNutrients' in subject)) return;
    expect(() =>
      subject.sumNutrients([
        { caloriesKcal: 1, proteinG: 1, carbsG: 1, fatG: 1, confidence },
      ]),
    ).toThrow(/confidence/i);
  });
});
